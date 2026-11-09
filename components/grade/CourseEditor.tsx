'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { autoSaveChanges, createAutoSaveQueue, encodeDraft, readEditorDraft, writeEditorDraft, removeEditorDraft } from '@/lib/grade/autosave';
import { AssessmentImageImport } from './AssessmentImageImport';
import type { AssignmentGroup, AssignmentTask, AssessmentProgress, ManagedAssessment, ManagedCourse } from '@/lib/grade/management-types';
import { validateManagedCourse } from '@/lib/grade/management';
import { assignmentChangeMessages } from '@/lib/grade/assignments';
import { prepareAttendanceEstimate, estimateAttendance, confirmedAttendanceBalance, estimateChangeMessages, ATTENDANCE_REFERENCE_URL } from '@/lib/grade/attendance-estimate';
import { resolveAttendanceAssessmentId, reconcileAttendanceLink, attendanceLinkOptions, attendanceLinkChangeError, selectAttendanceAssessment, removeAssessmentWithAttendanceLink } from '@/lib/grade/attendance-link';
import { Card } from '@/components/ui';
import { resolvePolicy, officialPolicy, policyCuts, policyCaps, GRADE_CUTOFFS, POLICY_LABELS, POLICY_URL, type GradingPolicy } from '@/lib/grade/grading-policy';

const fieldClass = 'w-full rounded-lg border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-3 py-2 text-[13px] text-[var(--e-ink)] outline-none focus:border-[var(--e-accent)]';
const buttonClass = 'rounded-lg border border-[var(--e-border-strong)] px-3 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2';
type RowDraft = {
  id: string; name: string; percent: string; maxScore: string; mean: string; stdev: string;
  ceilingClustered: boolean; status: AssessmentProgress['status'] | ''; score: string;
  reason: 'absent' | 'not_submitted' | '';
  group: { allocation: AssignmentGroup['allocation']; tasks: TaskDraft[] } | null;
};
type TaskDraft = { id: string; name: string; percent: string; maxScore: string; status: AssessmentProgress['status']; score: string };
const numberText = (n: number | null) => n === null ? '' : String(n);
const requiredNumber = (s: string) => s.trim() === '' ? NaN : Number(s);
const optionalNumber = (s: string) => s.trim() === '' ? null : Number(s);
function taskDraft(task: AssignmentTask): TaskDraft {
  return { id: task.id, name: task.name, percent: task.weight === null ? '' : String(Number((task.weight * 100).toFixed(8))), maxScore: String(task.maxScore), status: task.progress.status, score: task.progress.status === 'graded' ? String(task.progress.score) : '' };
}
const newTask = (tasks: TaskDraft[]): TaskDraft => {
  let number = 1;
  while (tasks.some((task) => task.name.trim() === `과제 ${number}`)) number++;
  return { id: crypto.randomUUID(), name: `과제 ${number}`, percent: '', maxScore: '100', status: 'scheduled', score: '' };
};
function rowDraft(a: ManagedAssessment): RowDraft {
  return {
    id: a.id, name: a.name, percent: String(Number((a.weight * 100).toFixed(8))),
    maxScore: String(a.maxScore), mean: numberText(a.mean), stdev: numberText(a.stdev),
    ceilingClustered: a.ceilingClustered, status: a.progress?.status ?? '',
    score: a.progress?.status === 'graded' ? String(a.progress.score) : '',
    reason: a.progress?.status === 'zero_confirmed' ? a.progress.reason : '',
    group: a.assignmentGroup ? { allocation: a.assignmentGroup.allocation, tasks: a.assignmentGroup.tasks.map(taskDraft) } : null,
  };
}

export function CourseEditor({ course, isNew, migration = false, mode = 'settings', onSave, onCancel, onAutoSave, onPreview }: {
  course: ManagedCourse;
  isNew: boolean;
  migration?: boolean;
  mode?: 'records' | 'settings';
  onSave: (course: ManagedCourse, confirmedAssignmentChanges: boolean, confirmedAttendanceChanges: boolean) => void;
  onCancel: () => void;
  onAutoSave?: (course:ManagedCourse,assignment:boolean,attendance:boolean)=>boolean;
  onPreview?: (course:ManagedCourse|null,invalid:boolean)=>void;
}) {
  const [prepared] = useState(() => prepareAttendanceEstimate(course));
  const initial = {
    name: course.name, professor: course.professor, credits: String(course.credits),
    enrolled: numberText(course.enrolled), rank:numberText(course.myRank??null), grading:resolvePolicy(course),
    assessments: course.assessments.map(rowDraft),
    estimate: prepared.value,
    cuts: Object.fromEntries(Object.keys(GRADE_CUTOFFS).map((key)=>[key,(policyCuts(course) as Record<string,number>)[key]===undefined?'':String((policyCuts(course) as Record<string,number>)[key])])),
    capA:String((policyCaps(course)?.a??.3)*100),capAB:String((policyCaps(course)?.ab??.7)*100),passScore:numberText(resolvePolicy(course).passScore??null),
    semester: course.semester ?? '',
  };
  const auto=!isNew&&!migration&&!!onAutoSave;
  const [draft, setDraft] = useState(()=>auto?readEditorDraft(course.id,course,(v):v is typeof initial=>{
    if(!v||typeof v!=='object')return false;const d=v as typeof initial;
    const strings=['name','professor','credits','enrolled','rank','capA','capAB','passScore','semester'] as const;
    const task=(t:TaskDraft)=>t&&['id','name','percent','maxScore','status','score'].every((k)=>typeof t[k as keyof TaskDraft]==='string');
    return strings.every((k)=>typeof d[k]==='string')&&!!d.grading&&Object.keys(POLICY_LABELS).includes(d.grading.kind)&&!!d.cuts&&Object.values(d.cuts).every((x)=>typeof x==='string')&&!!d.estimate&&Array.isArray(d.assessments)&&d.assessments.every((a)=>a&&['id','name','percent','maxScore','mean','stdev','status','score','reason'].every((k)=>typeof a[k as keyof RowDraft]==='string')&&typeof a.ceilingClustered==='boolean'&&(!a.group||(Array.isArray(a.group.tasks)&&a.group.tasks.every(task))));
  })??initial:initial);
  const [savedKey,setSavedKey]=useState(encodeDraft(initial));
  const [saveStatus,setSaveStatus]=useState('저장됨 ✓');
  const [retry,setRetry]=useState(0);
  const [linkNotice,setLinkNotice]=useState('');
  const urgent=useRef(false);
  const lastSaved=useRef(course);
  const acknowledged=useRef(encodeDraft(initial));
  const [queue]=useState(()=>createAutoSaveQueue({set:(fn,delay)=>window.setTimeout(fn,delay),clear:(id)=>window.clearTimeout(id as number)}));
  const [submitted, setSubmitted] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const recordsOnly = mode === 'records' && !isNew && !migration;
  const resultsEditable = recordsOnly || migration;
  const simple = isNew && !advanced && !migration;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const raw=encodeDraft(draft);
  const dirty = auto?raw!==savedKey:raw!==encodeDraft(initial);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { queue.flush(); if(!auto||acknowledged.current!==raw)event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty,auto,raw,queue]);

  const baseCourse = { ...course };
  delete baseCourse.semester;
  delete baseCourse.myRank;
  const attendanceId = resolveAttendanceAssessmentId(draft.assessments.map((a)=>({id:a.id,name:a.name,weight:requiredNumber(a.percent)/100,assignmentGroup:a.group,progress:a.status?{status:a.status}:null})),draft.estimate);
  const candidate: ManagedCourse = {
    ...baseCourse, attendanceEstimate: {...draft.estimate,assessmentId:attendanceId,...(attendanceId!==draft.estimate.assessmentId?{confirmed:undefined}:{})}, name: draft.name.trim(), professor: draft.professor.trim(),
    credits: requiredNumber(draft.credits), enrolled: optionalNumber(draft.enrolled), isAbsolute: draft.grading.kind==='absolute'||draft.grading.kind==='pass_fail'?true:draft.grading.kind.startsWith('relative')?false:course.isAbsolute,
    gradingPolicy:{...draft.grading,...(draft.grading.source==='custom'&&draft.grading.kind==='absolute'?{absoluteCutoffs:Object.fromEntries(Object.entries(draft.cuts).filter(([,s])=>s.trim()!=='').map(([key,s])=>[key,requiredNumber(s)]))}:{}),...(draft.grading.source==='custom'&&draft.grading.kind.startsWith('relative')?{relativeCaps:{a:requiredNumber(draft.capA)/100,ab:requiredNumber(draft.capAB)/100}}:{}),...(draft.grading.source==='custom'&&draft.grading.kind==='pass_fail'&&draft.passScore.trim()!==''?{passScore:requiredNumber(draft.passScore)}:{})},
    ...(draft.rank.trim()?{myRank:requiredNumber(draft.rank)}:{}),
    ...(draft.semester ? { semester: draft.semester } : {}),
    assessments: draft.assessments.map((row): ManagedAssessment => {
      const original = course.assessments.find((a) => a.id === row.id);
      const base = {
        id: row.id, name: row.name.trim(),
        // Preserve untouched legacy weights beyond the displayed precision.
        weight: original && row.percent === rowDraft(original).percent ? original.weight : requiredNumber(row.percent) / 100,
        maxScore: requiredNumber(row.maxScore), mean: optionalNumber(row.mean),
        stdev: optionalNumber(row.stdev), ceilingClustered: row.ceilingClustered,
        ...(row.group ? { assignmentGroup: {
          allocation: row.group.allocation,
          tasks: row.group.tasks.map((task): AssignmentTask => {
            const previous = original?.assignmentGroup?.tasks.find((t) => t.id === task.id);
            return {
              id: task.id, name: task.name.trim(), maxScore: requiredNumber(task.maxScore),
              weight: row.group!.allocation === 'equal' ? null : task.percent.trim() === '' ? null
                : previous && task.percent === taskDraft(previous).percent ? previous.weight : requiredNumber(task.percent) / 100,
              progress: task.status === 'graded' ? { status: 'graded', score: requiredNumber(task.score) }
                : task.status === 'zero_confirmed' ? { status: 'zero_confirmed', reason: 'not_submitted' } : { status: task.status },
            };
          }),
        } } : {}),
      };
      if (row.status === '') return { ...base, progress: null, reviewRequired: 'legacy_null_score' };
      const progress: AssessmentProgress = row.status === 'graded'
        ? { status: 'graded', score: requiredNumber(row.score) }
        : row.status === 'zero_confirmed'
          ? { status: 'zero_confirmed', reason: row.reason as 'absent' | 'not_submitted' }
          : { status: row.status };
      return { ...base, progress };
    }),
  };
  const errors = validateManagedCourse(candidate);
  if (migration && candidate.assessments.some((a) => a.id !== attendanceId && !a.assignmentGroup && a.progress === null)) errors.push('‘확인 필요’인 평가항목의 진행 상태를 선택해 주세요.');
  const total = draft.assessments.reduce((sum, a) => sum + (Number(a.percent) || 0), 0);
  const validTotal = Number.isFinite(total) && Math.abs(total - 100) <= 1e-6;
  const latest=useRef({candidate,errors,draft,onAutoSave,onPreview});
  useLayoutEffect(()=>{latest.current={candidate,errors,draft,onAutoSave,onPreview};});
  useEffect(()=>{
    if(!auto)return;
    const data=latest.current;
    if(raw===acknowledged.current)return;
    const backup=writeEditorDraft(course.id,lastSaved.current,data.draft);
    const changes=autoSaveChanges(lastSaved.current,data.candidate);
    let active=true;
    queueMicrotask(()=>{if(!active)return;setSubmitted(true);data.onPreview?.(data.errors.length?null:changes.messages.length?null:data.candidate,data.errors.length>0);setSaveStatus(data.errors.length?'입력 확인 필요 · 저장 보류':backup?'저장 중…':'저장 중… · 임시 복구 저장 불가');});
    if(!data.errors.length)queue.schedule(()=>{
      if(changes.messages.length&&!window.confirm(`변경 내용을 확인해 주세요.\n\n${changes.messages.join('\n')}\n\n취소해도 편집 내용은 유지됩니다.`)){setSaveStatus('변경 확인 필요 · 저장 보류');return;}
      data.onPreview?.(data.candidate,false);
      if(data.onAutoSave?.(data.candidate,changes.assignments,changes.attendance)){
        lastSaved.current=data.candidate;acknowledged.current=raw;setSavedKey(raw);removeEditorDraft(course.id);setSaveStatus('저장됨 ✓');
      }else setSaveStatus('저장 실패 · 다시 시도');
    },urgent.current?0:450);
    urgent.current=false;
    return ()=>{active=false;queue.cancel();};
  },[raw,retry,auto,queue,course.id]);
  useEffect(()=>{const flush=()=>queue.flush();window.addEventListener('pagehide',flush);return()=>{window.removeEventListener('pagehide',flush);queue.flush();};},[queue]);
  const updateAssessment = (id: string, patch: Partial<RowDraft>) => {
    setDraft((d) => {
      const assessments=d.assessments.map((a) => a.id === id ? { ...a, ...patch } : a);
      const estimate=reconcileAttendanceLink(assessments.map((a)=>({id:a.id,name:a.name,weight:requiredNumber(a.percent)/100,assignmentGroup:a.group,progress:a.status?{status:a.status}:null})),d.estimate);
      return {...d,assessments,estimate};
    });
  };
  const addAssessment = (name: string) => {
    setDraft((d) => ({ ...d, assessments: [...d.assessments, {
      id: crypto.randomUUID(), name, percent: '', maxScore: '100', mean: '', stdev: '',
      ceilingClustered: name === '출석', status: 'scheduled', score: '', reason: '',
      group: null,
    }] }));
  };
  const linkChangeError=attendanceLinkChangeError(candidate);
  const chooseAttendance=(id:string|null)=>{
    const next=selectAttendanceAssessment(candidate,id);
    if(!next.ok){setLinkNotice(next.errors.join(' '));return;}
    setLinkNotice('');urgent.current=true;
    setDraft((d)=>({...d,estimate:next.value.attendanceEstimate!,assessments:d.assessments.map((row)=>{
      const before=candidate.assessments.find((a)=>a.id===row.id),after=next.value.assessments.find((a)=>a.id===row.id);
      if(!after||JSON.stringify(before?.progress)===JSON.stringify(after.progress))return row;
      const restored=rowDraft(after);
      return {...row,status:restored.status,score:restored.score,reason:restored.reason};
    })}));
  };

  return (
    <Card className="p-4">
      <h3 ref={headingRef} tabIndex={-1} className="mb-2 text-[16px] font-semibold outline-none">
        {migration ? `${course.name} 이전 검토` : isNew ? '과목 추가' : recordsOnly ? '이번 주 기록하기' : '과목 설정'}
      </h3>
      <p className="mb-3 text-[12px] text-[var(--e-muted)]">{auto?'변경하면 바로 계산하고 자동 저장해요.':'과목명·학점·평가비율을 확인해 주세요.'}</p>
      {auto?<div role="status" aria-live="polite" className="mb-3 flex flex-wrap items-center gap-2 text-[12px]" data-autosave-state={dirty?'pending':'saved'}><span>{saveStatus}</span>{saveStatus.includes('실패')||saveStatus.includes('변경 확인')?<button type="button" className="min-h-9 underline" onClick={()=>{urgent.current=true;setRetry((r)=>r+1);}}>다시 시도</button>:null}{dirty?<span className="text-[var(--e-muted)]">편집값 유지 중</span>:null}</div>:null}
      {migration ? <p className="mb-4 rounded-lg bg-[var(--e-surface-2)] p-3 text-[13px]">기존 점수와 비율을 확인하고, ‘확인 필요’인 항목의 상태를 선택해 주세요. 이 과목의 검토를 마쳐도 전체 이전을 확인하기 전에는 저장하지 않습니다.</p> : null}
      <form noValidate onChangeCapture={(e)=>{urgent.current=e.target instanceof HTMLSelectElement||(e.target instanceof HTMLInputElement&&['checkbox','radio'].includes(e.target.type));}} onClickCapture={(e)=>{if((e.target as HTMLElement).closest('button[type="button"]'))urgent.current=true;}} onSubmit={(e) => {
        e.preventDefault();
        if(auto){queue.flush();return;}
        setSubmitted(true);
        if (!errors.length) {
          const changes = assignmentChangeMessages([course], [candidate]);
          const attendanceChanges = estimateChangeMessages([course], [candidate]);
          const allChanges = [...changes, ...attendanceChanges];
          if (allChanges.length && !window.confirm(`다음 기록·배점 변경을 저장할까요?\n\n${allChanges.join('\n')}\n\n취소하면 현재 편집 내용은 유지됩니다.`)) return;
          onSave(candidate, changes.length > 0, attendanceChanges.length > 0);
        }
      }} className="flex flex-col gap-4">
        {!recordsOnly&&!migration?<AssessmentImageImport assessments={candidate.assessments} preserveAssessmentIds={attendanceId&&(draft.estimate.selection==='manual'||draft.estimate.confirmed)?[attendanceId]:[]} onApply={(assessments)=>setDraft((d)=>({...d,estimate:reconcileAttendanceLink(assessments,d.estimate.assessmentId&&!assessments.some((a)=>a.id===d.estimate.assessmentId)?{...d.estimate,assessmentId:null,confirmed:undefined}:d.estimate),assessments:assessments.map((a)=>{const previous=d.assessments.find((r)=>r.id===a.id);return previous?{...previous,name:a.name,percent:String(Number((a.weight*100).toFixed(8)))}:rowDraft(a);})}))} />:null}
        <div hidden={recordsOnly} className={recordsOnly ? 'hidden' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
          <Field label="과목명" value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} required />
          <Field label="학점" type="number" value={draft.credits} onChange={(credits) => setDraft((d) => ({ ...d, credits }))} required />
        </div>
        {!recordsOnly?<fieldset className="rounded-xl border border-[var(--e-border)] p-3"><legend className="px-1 text-[14px] font-semibold">성적평가 방식</legend><label className="flex flex-col gap-1 text-[12px]"><span>평가 방식</span><select className={fieldClass} value={draft.grading.kind} onChange={(event)=>{const p=officialPolicy(event.target.value as GradingPolicy['kind']);const c={...candidate,gradingPolicy:p};setDraft((d)=>({...d,grading:p,cuts:Object.fromEntries(Object.keys(GRADE_CUTOFFS).map((k)=>[k,(policyCuts(c) as Record<string,number>)[k]===undefined?'':String((policyCuts(c) as Record<string,number>)[k])])),capA:String((policyCaps(c)?.a??.3)*100),capAB:String((policyCaps(c)?.ab??.7)*100),passScore:''}));}}>{Object.entries(POLICY_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <p className="mt-2 text-[12px]">{draft.grading.source==='official'?'ERICA 공식 프리셋':draft.grading.source==='custom'?'교수자 별도 기준':'기준 확인 필요 · 점수 분석은 계속 가능'}</p>
          <details className="mt-3 rounded-lg bg-[var(--e-surface-2)] p-3 text-[12px]">
            <summary className="cursor-pointer font-semibold">상대평가 1·2·3은 뭐가 다른가요?</summary>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left"><caption className="mb-2 text-left">ERICA 공식 안내의 대표 적용 대상</caption><thead><tr><th className="p-1">방식</th><th className="p-1">A 최대</th><th className="p-1">A+B 최대</th><th className="p-1">대표 대상</th></tr></thead><tbody>
              <tr><th className="p-1">상대평가 1</th><td className="p-1">30%</td><td className="p-1">70%</td><td className="p-1">이론 교과목 · 성적 부여 인원 12명 이상</td></tr>
              <tr><th className="p-1">상대평가 2</th><td className="p-1">40%</td><td className="p-1">80%</td><td className="p-1">이론+실습 교과목 · 성적 부여 인원 20명 이상</td></tr>
              <tr><th className="p-1">상대평가 3</th><td className="p-1">50%</td><td className="p-1">90%</td><td className="p-1">IC-PBL(E·C·A), 일부 초청강연·명품강좌</td></tr>
            </tbody></table></div>
            <p className="mt-2">A는 A+와 A0를 합친 비율입니다. A+B 70%는 B만 70%라는 뜻이 아닙니다. 모두 최대 비율이며 반드시 이만큼 부여되는 것은 아닙니다.</p>
            <p className="mt-2">인원은 수강포기 후 최종 성적 부여 인원 기준입니다. 영어전용·실습·IC-PBL(M) 등 예외가 있으므로 과목명이나 현재 수강인원만으로 자동 선택하지 않습니다.</p>
            <a className="mt-2 inline-block underline" href={POLICY_URL} target="_blank" rel="noreferrer">공식 적용 대상 확인 · 실제 방식은 강의계획서·수업 안내 우선</a>
          </details>
          {policyCaps(candidate)?<p className="mt-2 text-[12px]">A 최대 {Math.round(policyCaps(candidate)!.a*100)}% · A+B 최대 {Math.round(policyCaps(candidate)!.ab*100)}%. 실제 부여율이나 A+/A0 확률이 아닙니다.</p>:null}
          {draft.grading.kind==='absolute'?<p className="mt-2 text-[12px]">최종점수 등급표를 100점 합계에 직접 적용하는 가정입니다. 교수자의 별도 원점수 환산은 자동 보장하지 않습니다.</p>:null}
          {draft.grading.kind==='pass_fail'?<p className="mt-2 text-[12px]">P/F 합격점은 강좌별로 확인해야 합니다. S/U의 70점 기준을 대신 적용하지 않습니다.</p>:null}
          {draft.grading.kind!=='unknown'?<details className="mt-3 text-[12px]"><summary className="cursor-pointer">기준표·교수자 별도 기준 (선택)</summary>
            {draft.grading.source==='unconfirmed'?<button type="button" className={buttonClass+' mt-2'} onClick={()=>{const p=officialPolicy(draft.grading.kind);setDraft((d)=>({...d,grading:p,cuts:Object.fromEntries(Object.keys(GRADE_CUTOFFS).map((k)=>[k,(policyCuts({...candidate,gradingPolicy:p}) as Record<string,number>)[k]===undefined?'':String((policyCuts({...candidate,gradingPolicy:p}) as Record<string,number>)[k])]))}));}}>공식 프리셋 적용</button>:null}
            <label className="mt-3 flex min-h-11 items-center gap-2"><input type="checkbox" checked={draft.grading.source==='custom'} onChange={(event)=>setDraft((d)=>({...d,grading:event.target.checked?{kind:d.grading.kind,source:'custom',presetVersion:d.grading.presetVersion}:officialPolicy(d.grading.kind)}))} />교수자 별도 기준 사용</label>
            {draft.grading.kind==='absolute'?<div className="grid grid-cols-2 gap-2">{Object.keys(GRADE_CUTOFFS).map((key)=>draft.grading.source==='custom'?<Field key={key} label={`${key} 기준점수`} type="number" value={draft.cuts[key]} onChange={(v)=>setDraft((d)=>({...d,cuts:{...d.cuts,[key]:v}}))} />:<p key={key}>{key}: {(policyCuts(candidate) as Record<string,number>)[key]??'미확인'}점 이상</p>)}</div>:null}
            {draft.grading.source==='custom'&&draft.grading.kind.startsWith('relative')?<div className="grid grid-cols-2 gap-2"><Field label="A 계열 상한 (%)" type="number" value={draft.capA} onChange={(capA)=>setDraft((d)=>({...d,capA}))} /><Field label="A+B 상한 (%)" type="number" value={draft.capAB} onChange={(capAB)=>setDraft((d)=>({...d,capAB}))} /></div>:null}
            {draft.grading.source==='custom'&&draft.grading.kind==='pass_fail'?<Field label="P 합격 기준점수" type="number" value={draft.passScore} onChange={(passScore)=>setDraft((d)=>({...d,passScore}))} />:null}
            <a className="mt-3 inline-block underline" href={POLICY_URL} target="_blank" rel="noreferrer">ERICA 공식 안내 · 적용 학기·강좌 예외 확인</a>
          </details>:null}
        </fieldset>:null}
        {!recordsOnly && !simple ? <details className="rounded-xl border border-[var(--e-border)] p-3"><summary className="cursor-pointer text-[13px] font-semibold">학기·교수·분석 옵션</summary><div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="교수명 (선택)" value={draft.professor} onChange={(professor) => setDraft((d) => ({ ...d, professor }))} />
          <Field label="학기 (선택: 2026-2)" value={draft.semester} onChange={(semester) => setDraft((d) => ({ ...d, semester }))} />
          <Field label="수강인원 (선택)" type="number" value={draft.enrolled} onChange={(enrolled) => setDraft((d) => ({ ...d, enrolled }))} />
          <Field label="현재 등수 (선택)" type="number" value={draft.rank} onChange={(rank)=>setDraft((d)=>({...d,rank}))} />
        </div></details> : null}
        {resultsEditable ? <AttendanceEstimateCard course={candidate} onChange={(key, delta) => setDraft((d)=>({...d,estimate:{...d.estimate,[key]:Math.max(0,d.estimate[key]+delta)}}))} review={prepared.review} /> : null}
        {!recordsOnly ? <fieldset className="min-w-0 rounded-xl border border-[var(--e-border)] p-3"><legend className="px-1 text-[14px] font-semibold">출석 관리</legend>
          <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-[var(--e-ink-2)]"><span>출석 점수 항목 선택</span>
            <select aria-label="출석 점수 항목 선택" className={fieldClass+' min-h-11 min-w-0 max-w-full'} value={attendanceId??(draft.estimate.selection==='manual'?'':'__unselected')} disabled={!!linkChangeError} onChange={(event)=>chooseAttendance(event.target.value||null)}>
              {/* A distinct hidden initial value lets explicitly choosing none emit onChange. */}
              {attendanceId===null&&draft.estimate.selection!=='manual'?<option value="__unselected" hidden disabled>연결 안 함</option>:null}
              <option value="">연결 안 함</option>
              {attendanceLinkOptions(candidate.assessments,attendanceId).map((option)=><option key={option.id} value={option.id} disabled={!!option.reason}>{option.name} ({Number.isFinite(option.weight)?Number((option.weight*100).toFixed(2)):'?'}%){option.reason?` · ${option.reason}`:''}</option>)}
            </select>
          </label>
          <p className="mt-2 text-[12px] text-[var(--e-muted)]">{attendanceId?'선택한 항목을 기준으로 출석 점수를 예상해요.':'출석 점수와 연결된 평가항목이 없어요. 결석·지각 기록은 계속할 수 있어요.'}</p>
          {linkChangeError||linkNotice?<p role="status" className="mt-2 text-[12px]">{linkChangeError||linkNotice}</p>:null}
          <div className="mt-3"><Field label="총 수업 횟수" type="number" value={Number.isFinite(draft.estimate.totalSessions??15)?String(draft.estimate.totalSessions??15):''} onChange={(value)=>setDraft((d)=>({...d,estimate:{...d.estimate,totalSessions:requiredNumber(value)}}))} /></div>
          <p className="mt-2 text-[12px] text-[var(--e-muted)]">기본 15회 · 지각 3회당 결석 1회</p>
        </fieldset> : null}
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-2 text-[14px] font-semibold">평가항목</legend>
          {draft.assessments.filter((a)=>!recordsOnly||a.id!==attendanceId).map((a, index) => (
            <fieldset key={a.id} className="min-w-0 rounded-xl border border-[var(--e-border)] p-3">
              <legend className="px-1 text-[13px] font-semibold">{recordsOnly ? a.name : `평가항목 ${index + 1}`}</legend>
              {recordsOnly && !a.group && a.id !== attendanceId ? <p className="mb-2 text-[12px] text-[var(--e-muted)]">{a.maxScore}점 만점 · 만점 변경은 설정에서</p> : null}
              <div className="grid grid-cols-2 gap-3">
                {!recordsOnly ? <><Field label="항목명" value={a.name} onChange={(name) => updateAssessment(a.id, { name })} required />
                <Field label="반영비율 (%)" type="number" value={a.percent} onChange={(percent) => updateAssessment(a.id, { percent })} required /></> : null}
                {!recordsOnly && !simple && a.id!==attendanceId ? <Field label="만점" type="number" value={a.maxScore} onChange={(maxScore) => updateAssessment(a.id, { maxScore })} required /> : null}
                {resultsEditable && !a.group && a.id !== attendanceId ? <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-[var(--e-ink-2)]">
                  <span>진행 상태</span>
                  <select className={fieldClass} value={a.status} onChange={(e) => {
                    const status = e.target.value as RowDraft['status'];
                    if (status === a.status) return;
                    if ((a.status === 'graded' || a.status === 'zero_confirmed') && !window.confirm('진행 상태를 바꾸면 이 항목의 기존 점수 또는 0점 사유가 제거됩니다. 계속할까요?')) return;
                    updateAssessment(a.id, { status, score: '', reason: '' });
                  }}>
                    {a.status === '' ? <option value="">확인 필요 — 상태 선택</option> : null}
                    <option value="scheduled">예정</option>
                    <option value="awaiting_grade">채점 대기</option>
                    <option value="graded">점수 확정</option>
                    <option value="zero_confirmed">0점 확정</option>
                  </select>
                </label> : null}
                {resultsEditable && !a.group && a.id !== attendanceId && a.status === 'graded' ? <Field label="확정 점수" type="number" value={a.score} onChange={(score) => updateAssessment(a.id, { score })} required /> : null}
                {resultsEditable && !a.group && a.id !== attendanceId && a.status === 'zero_confirmed' ? (
                  <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-[var(--e-ink-2)]">
                    <span>0점 확정 사유</span>
                    <select required className={fieldClass} value={a.reason} onChange={(e) => updateAssessment(a.id, { reason: e.target.value as RowDraft['reason'] })}>
                      <option value="">사유 선택</option><option value="absent">미응시</option><option value="not_submitted">미제출</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {a.id === attendanceId ? <p className="mt-2 text-[12px]">이 비율을 출석 카드에서 사용합니다. 출석 만점에서 기록된 결석·지각만큼 차감합니다.</p> : null}
              {!simple && a.id !== attendanceId && (a.group || /과제|assignment|homework/i.test(a.name)) ? <div className="mt-3 rounded-lg bg-[var(--e-surface-2)] p-3">
                {a.group ? (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold">과제 세부 관리 · {a.group.tasks.length}개</summary>
                    {!recordsOnly ? <><p className="mt-2 text-[12px]">전체 반영비율 {a.percent || '확인 필요'}%. 상위 항목의 기존 점수는 보관하고 계산에서 제외합니다. 점수가 있는 과제의 삭제·재배분은 저장 전에 변경 내용을 확인받습니다.</p>
                    <p className="mt-1 text-[12px]">보관한 단일 기록: {a.status === 'graded' ? `${a.score} / ${a.maxScore}` : a.status === 'zero_confirmed' ? '0점 확정' : a.status === 'awaiting_grade' ? '채점 대기' : a.status === 'scheduled' ? '예정' : '상태 확인 필요'}</p>
                    <label className="mt-3 flex flex-col gap-1.5 text-[12px]"><span>과제 배점 방식</span>
                      <select className={fieldClass} value={a.group.allocation} onChange={(e) => {
                        const allocation = e.target.value as AssignmentGroup['allocation'];
                        updateAssessment(a.id, { group: { allocation, tasks: a.group!.tasks.map((task) => ({ ...task, percent: allocation === 'equal' ? '' : a.group!.allocation === 'equal' && allocation === 'individual' ? String(100 / a.group!.tasks.length) : task.percent })) } });
                      }}><option value="unconfirmed">배점 확인 필요</option><option value="equal">균등 배점 (직접 선택)</option><option value="individual">개별 배점</option></select>
                    </label>
                    </> : null}
                    {a.group.allocation === 'unconfirmed' ? <p className="mt-2 text-[12px]">배점은 설정에서 확인할 수 있습니다. 현재 상태·점수 기록은 저장 가능합니다.</p> : null}
                    {a.group.allocation === 'individual' ? <p role="status" className="mt-2 text-[12px]">과제 내부 비율 합계: {Number(a.group.tasks.reduce((sum, task) => sum + (Number(task.percent) || 0), 0).toFixed(8))}% / 100%</p> : null}
                    <ul className="mt-3 flex flex-col gap-2">{a.group.tasks.map((task, taskIndex) => {
                      const update = (patch: Partial<TaskDraft>) => {
                        if(patch.status&&patch.status!==task.status&&(task.status==='graded'||task.status==='zero_confirmed')&&!window.confirm('진행 상태를 바꾸면 기존 과제 점수가 제거됩니다. 계속할까요?'))return;
                        updateAssessment(a.id, { group: { ...a.group!, tasks: a.group!.tasks.map((item) => item.id === task.id ? { ...item, ...patch } : item) } });
                      };
                      const internal = a.group!.allocation === 'equal' ? 100 / a.group!.tasks.length : a.group!.allocation === 'individual' && task.percent.trim() ? Number(task.percent) : null;
                      return <li key={task.id}><details className="rounded-lg border border-[var(--e-border)] bg-[var(--e-surface)] p-3" data-task-id={task.id}>
                        <summary className="cursor-pointer break-words text-[12px] font-semibold">{task.name || `과제 ${taskIndex + 1}`} · {task.status === 'graded' ? `점수 확정 ${task.score || '입력 필요'} / ${task.maxScore}` : task.status === 'awaiting_grade' ? '채점 대기' : task.status === 'zero_confirmed' ? '미제출 0점 확정' : '예정'} · {internal === null ? '배점 확인 필요' : `내부 ${Number(internal.toFixed(4))}%`}</summary>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          {!recordsOnly ? <><Field label="개별 과제명" value={task.name} onChange={(name) => update({ name })} required />
                          <Field label="개별 과제 만점" type="number" value={task.maxScore} onChange={(maxScore) => update({ maxScore })} required />
                          {a.group!.allocation === 'individual' ? <Field label="과제 내부 비율 (%)" type="number" value={task.percent} onChange={(percent) => update({ percent })} required /> : null}</> : null}
                          {resultsEditable ? <label className="flex flex-col gap-1.5 text-[12px]"><span>개별 과제 진행 상태</span><select className={fieldClass} value={task.status} onChange={(e) => update({ status: e.target.value as TaskDraft['status'], score: '' })}><option value="scheduled">예정</option><option value="awaiting_grade">채점 대기</option><option value="graded">점수 확정</option><option value="zero_confirmed">미제출 0점 확정</option></select></label> : null}
                          {resultsEditable && task.status === 'graded' ? <Field label="개별 과제 확정 점수" type="number" value={task.score} onChange={(score) => update({ score })} required /> : null}
                        </div>
                        {!recordsOnly ? <button type="button" className="mt-3 text-[12px] underline" aria-label={`세부 과제 ${taskIndex + 1} 삭제`} onClick={() => updateAssessment(a.id, { group: { ...a.group!, tasks: a.group!.tasks.filter((item) => item.id !== task.id) } })}>세부 과제 삭제</button> : null}
                      </details></li>;
                    })}</ul>
                    {!a.group.tasks.length ? <p className="mt-2 text-[12px]">세부 과제를 하나 이상 추가해 주세요.</p> : null}
                    {!recordsOnly ? <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={buttonClass} onClick={() => updateAssessment(a.id, { group: { ...a.group!, tasks: [...a.group!.tasks, newTask(a.group!.tasks)] } })}>+ 세부 과제 추가</button>
                      <button type="button" className={buttonClass} onClick={() => updateAssessment(a.id, { group: null })}>단일 과제 관리로 복원</button>
                    </div> : null}
                  </details>
                ) : !recordsOnly ? <details><summary className="cursor-pointer text-[13px] font-semibold">과제 세부 관리 (선택)</summary>
                  <p className="my-2 text-[12px]">과제 개수·배점을 모르면 단일 항목 그대로 두세요. 전환 시 기존 점수는 보관하고 저장 전에 변경 내용을 확인합니다.</p>
                  <button type="button" className={buttonClass} onClick={() => updateAssessment(a.id, { group: { allocation: 'unconfirmed', tasks: [newTask([])] } })}>세부 과제로 전환</button>
                </details> : <p className="text-[12px]">과제 전체 점수로 기록 중입니다. 필요할 때 설정에서 세부 관리를 선택하세요.</p>}
              </div> : null}
              {!recordsOnly && !simple && a.id!==attendanceId ? <details className="mt-3 text-[12px]">
                <summary className="cursor-pointer font-medium">추가 통계·분석 설정</summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="반 평균 (선택)" type="number" value={a.mean} onChange={(mean) => updateAssessment(a.id, { mean })} />
                  <Field label="표준편차 (선택)" type="number" value={a.stdev} onChange={(stdev) => updateAssessment(a.id, { stdev })} />
                </div>
                <label className="mt-3 flex items-start gap-2">
                  <input className="mt-0.5" type="checkbox" checked={a.ceilingClustered} onChange={(e) => updateAssessment(a.id, { ceilingClustered: e.target.checked })} />
                  대부분 만점인 항목 (천장 밀집: 분포 합성에서 제외하고 감점 반영)
                </label>
              </details> : null}
              {!recordsOnly ? <button type="button" className="mt-3 text-[12px] underline underline-offset-2 disabled:opacity-40" aria-label={`평가항목 ${index + 1} 삭제`} disabled={!removeAssessmentWithAttendanceLink(candidate,a.id).ok} title={!removeAssessmentWithAttendanceLink(candidate,a.id).ok?'기존 출석 기록 보존을 위해 먼저 연결을 해제해 주세요.':undefined} onClick={() => {
                const next=removeAssessmentWithAttendanceLink(candidate,a.id);
                if(!next.ok){setLinkNotice(next.errors.join(' '));return;}
                if (!window.confirm('이 평가항목을 삭제할까요? 저장된 점수도 함께 제거됩니다.')) return;
                setDraft((d) => ({ ...d, estimate:next.value.attendanceEstimate??d.estimate,assessments: d.assessments.filter((item) => item.id !== a.id) }));
              }}>항목 삭제</button> : null}
            </fieldset>
          ))}
          {!draft.assessments.length ? <p className="text-[13px]">평가항목을 하나 이상 추가해 주세요.</p> : null}
          {!recordsOnly ? <div className="flex flex-wrap gap-2">
            {['중간고사', '기말고사', '과제', '출석', '기타'].map((name) => <button key={name} type="button" className={buttonClass} onClick={() => addAssessment(name)}>+ {name}</button>)}
          </div> : null}
          {!recordsOnly ? <p role="status" className="text-[13px] font-semibold">반영비율 합계: {Number.isFinite(total) ? Number(total.toFixed(8)) : '확인 필요'}% — {validTotal ? '합계가 맞습니다' : '100%가 되도록 조정해 주세요'}</p> : null}
          {simple ? <p className="text-[12px] text-[var(--e-muted)]">각 항목은 100점 만점·예정 상태로 시작합니다. 점수와 만점은 등록 후 기록·설정에서 변경할 수 있습니다.</p> : null}
        </fieldset>
        {isNew ? <button type="button" className={buttonClass} aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? '간편 등록으로 접기' : '상세 설정 (선택)'}</button> : null}
        {submitted && errors.length ? <div role="alert" className="rounded-xl bg-[var(--e-surface-2)] p-3 text-[13px]"><p className="font-semibold">입력 내용을 확인해 주세요.</p><ul className="mt-2 list-disc pl-5">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul></div> : null}
        <div className="flex flex-wrap gap-2">
          {!auto?<button type="submit" className={buttonClass + ' bg-[var(--e-accent)] text-white'}>{migration ? '이 과목 검토 완료' : '과목 등록'}</button>:null}
          {!auto?<button type="button" className={buttonClass} onClick={() => { if (!dirty || window.confirm('저장하지 않은 편집 내용을 버리고 돌아갈까요?')) onCancel(); }}>취소</button>:null}
        </div>
      </form>
    </Card>
  );
}

export function AttendanceEstimateCard({course,onChange,review=[]}:{course:ManagedCourse;onChange?:(key:'absences'|'lateness',delta:number)=>void;review?:string[]}) {
  const e=course.attendanceEstimate??prepareAttendanceEstimate(course).value;
  const recorded=confirmedAttendanceBalance({...course,attendanceEstimate:e});
  const result={...estimateAttendance({...course,attendanceEstimate:e}),score:recorded.secured,deduction:recorded.lost};
  const show=(n:number)=>Number(n.toFixed(2));
  if(!result.valid)return <p role="alert">총 수업 횟수를 설정 탭에서 확인해 주세요.</p>;
  return <section aria-label="출석 관리" className="rounded-xl border border-[var(--e-border)] bg-[var(--e-surface)] p-4">
    <div className="flex items-center justify-between"><h4 className="text-[14px] font-semibold">출석 관리</h4><span className="rounded-full bg-[var(--e-surface-2)] px-2 py-1 text-[11px]">기록 반영</span></div>
    {result.maximum>0?<div className="mt-3" aria-live="polite"><p className="text-[12px] text-[var(--e-muted)]">출석 점수</p><p className="mt-1 text-[30px] font-bold text-[var(--e-secured)]" data-attendance="estimate">{show(result.score)} <span className="text-[14px] font-normal text-[var(--e-ink)]">/ {show(result.maximum)}점</span></p><div role="img" aria-label={`출석 기록 점수 ${show(result.score)} / ${show(result.maximum)}점`} className="mt-2 h-3 overflow-hidden rounded-full bg-[#d9e5df]"><div className="h-full bg-[var(--e-secured)]" style={{width:`${100*result.score/result.maximum}%`}} /></div><p className="mt-2 text-[13px]">출석 감점: −{show(result.deduction)}점</p></div>:<p className="mt-3 text-[13px]">출석 점수와 연결된 평가항목이 없어요. 결석·지각 기록은 계속할 수 있어요.</p>}
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">{(['absences','lateness'] as const).map((key,i)=><div key={key} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--e-surface-2)] p-2"><span className="text-[13px]">{['결석','지각'][i]}</span><div className="flex items-center gap-2">{onChange?<button type="button" aria-label={`${['결석','지각'][i]} 1 감소`} className={buttonClass+' min-h-11 min-w-11 disabled:opacity-40'} disabled={e[key]===0} onClick={()=>onChange(key,-1)}>−</button>:null}<output aria-live="polite" data-attendance-count={key} className="min-w-6 text-center text-[18px] font-semibold tabular-nums">{e[key]}</output>{onChange?<button type="button" aria-label={`${['결석','지각'][i]} 1 증가`} className={buttonClass+' min-h-11 min-w-11'} onClick={()=>onChange(key,1)}>+</button>:null}</div></div>)}</div>
    <p className="mt-2 text-[12px] text-[var(--e-muted)]">총 {result.totalSessions}회 가정 · 지각 3회당 결석 1회 가정</p>
    <div className="mt-3 rounded-lg bg-[var(--e-surface-2)] p-3"><p className="text-[13px] font-semibold">남은 결석 여유: {result.remainingAllowance}회 / {result.allowedAbsences}회</p><div className="mt-2 text-[18px]" role="img" aria-label={`결석 여유 ${result.remainingAllowance}회, 추정 허용 ${result.allowedAbsences}회`}>{result.allowedAbsences<=8?Array.from({length:result.allowedAbsences},(_,i)=><span key={i} aria-hidden="true" style={{color:i<result.remainingAllowance?'var(--e-secured)':'#c3ccc6'}}>♥ </span>):<span aria-hidden="true" className="text-[14px]">♥ {result.remainingAllowance} / {result.allowedAbsences}</span>}</div></div>
    {result.caution!=='none'?<p role={result.caution==='below_reference'?'alert':'status'} className={'mt-3 rounded-lg p-3 text-[13px] '+(result.caution==='below_reference'?'border border-red-300 bg-red-50 font-semibold text-red-900':'bg-amber-50 text-amber-900')} data-attendance="caution">{result.caution==='boundary'?`허용 경계: 유효 결석 ${result.effectiveAbsences}회입니다. 다음 결석 시 가정상 기준을 초과합니다.`:result.caution==='warning'?`주의: 결석 여유가 ${result.remainingAllowance}회 남았습니다.`:`출석 기준 미달 추정: 유효 결석 ${result.effectiveAbsences}회로 허용 ${result.allowedAbsences}회를 초과했습니다. 실제 시험 응시 가능 여부를 확인하세요. F 확정은 아닙니다.`}</p>:null}
    <p className="mt-3 text-[12px] text-[var(--e-muted)]">출석은 만점으로 시작하고 기록한 결석·지각만큼 차감합니다. 요약·성적 전망·목표 점수에 바로 반영합니다.</p>
    <details className="mt-2 text-[12px]"><summary className="cursor-pointer">계산 가정 보기</summary><p className="mt-2">동일 길이 수업 {result.totalSessions}회, 지각 3회당 결석 1회로 가정합니다. 유효 결석은 결석 + floor(지각 / 3), 감점은 출석 배점 × 유효 결석 / {result.totalSessions}입니다. 주당 수업 횟수·시간·교수자의 실제 감점 방식에 따라 달라집니다.</p><p className="mt-2">총 수업시간의 2/3 출석 기준을 참고하면 위 가정에서는 {result.minimumAttendance}회 이상 출석이 필요합니다. 실제 출석 확인이나 F 확정 판정이 아닙니다. 공결은 여기서 감점하지 않습니다.</p><a className="mt-2 inline-block underline" href={ATTENDANCE_REFERENCE_URL} target="_blank" rel="noreferrer">ERICA 공식 학사 안내</a></details>
    {review.length?<details className="mt-3 text-[12px]"><summary className="cursor-pointer">기존 기록 전환 내용 · 저장 전에 확인</summary><ul className="mt-2 list-disc space-y-1 pl-4">{review.map((message,i)=><li key={i}>{message}</li>)}</ul><p className="mt-2">저장 확인 전에는 기존 데이터를 변경하지 않습니다.</p></details>:null}
  </section>;
}

function Field({ label, value, onChange, type = 'text', required = false }: {
  label: string; value: string; onChange: (value: string) => void; type?: 'text' | 'number'; required?: boolean;
}) {
  return <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-[var(--e-ink-2)]"><span>{label}</span><input className={fieldClass} type={type} step={type === 'number' ? 'any' : undefined} inputMode={type === 'number' ? 'decimal' : undefined} value={value} required={required} onChange={(e) => onChange(e.target.value)} /></label>;
}
