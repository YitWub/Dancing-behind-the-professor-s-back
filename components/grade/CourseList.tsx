'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssessmentProgress, FourAreaBalance, ManagedAssessment, ManagedCourse } from '@/lib/grade/management-types';
import { loadCourses } from '@/lib/grade/course-storage';
import { newCourse } from '@/lib/grade/course-validation';

import { computeManagedBalance } from '@/lib/grade/managed-balance';
import { summarizeScore } from '@/lib/grade/score-summary';
import { simulateCourse } from '@/lib/grade/course-simulation';
import { computeAssignmentBalance } from '@/lib/grade/assignments';
import { assessmentSummary } from '@/lib/grade/course-experience';
import { loadManagedCourses, prepareV1Migration, saveManagedCourses, saveV1Migration, type V1MigrationPreview } from '@/lib/grade/managed-storage';
import { prepareAttendanceEstimate, estimateAttendance } from '@/lib/grade/attendance-estimate';


import { Card, SectionTitle } from '@/components/ui';
import { gradeActionPlan } from '@/lib/grade/dashboard-insights';
import { forecastPresentation } from '@/lib/grade/forecast-presentation';
import { planningUnits } from '@/lib/grade/grade-planner';
import { resolvePolicy } from '@/lib/grade/grading-policy';
import { CourseEditor, AttendanceEstimateCard } from './CourseEditor';

const buttonClass = 'rounded-lg border border-[var(--e-border-strong)] px-3 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
type StoreState = {
  mode: 'loading' | 'ready' | 'migration' | 'error';
  courses: ManagedCourse[]; snapshot: string | null; preview: V1MigrationPreview | null; errors: string[];
};
const EMPTY: StoreState = { mode: 'loading', courses: [], snapshot: null, preview: null, errors: [] };
const AREAS: { key: keyof FourAreaBalance; label: string; color: string }[] = [
  { key: 'secured', label: '확보 점수', color: 'var(--e-secured)' },
  { key: 'lost', label: '상실 점수', color: 'var(--e-lost)' },
  { key: 'ungraded', label: '미확정 점수', color: 'var(--e-ord-2)' },
  { key: 'remaining', label: '남은 배점', color: 'var(--e-remaining)' },
];
const points = (n: number) => Number(n.toFixed(2));

function readStore(): StoreState {
  const v2 = loadManagedCourses();
  if (!v2.ok) return { ...EMPTY, mode: 'error', errors: v2.errors };
  // An existing v2 document (including an empty list) is authoritative. Never merge v1.
  if (v2.value.snapshot !== null) return { ...EMPTY, mode: 'ready', ...v2.value };
  const v1 = loadCourses();
  if (!v1.ok) return { ...EMPTY, mode: 'error', errors: [v1.error] };
  if (v1.courses.length === 0) return { ...EMPTY, mode: 'ready' };
  const preview = prepareV1Migration();
  return preview.ok ? { ...EMPTY, mode: 'migration', preview: preview.value } : { ...EMPTY, mode: 'error', errors: preview.errors };
}

function createCourse(): ManagedCourse {
  const { assessments, ...base } = newCourse(crypto.randomUUID());
  return { ...base, assessments: assessments.map((a) => ({
    id: a.id, name: a.name, weight: a.weight, maxScore: a.maxScore,
    mean: a.mean, stdev: a.stdev, ceilingClustered: a.ceilingClustered, progress: { status: 'scheduled' },
  })) };
}

function progressText(a: ManagedAssessment, course?: ManagedCourse): string {
  if (course && a.id===prepareAttendanceEstimate(course).value.assessmentId) return assessmentSummary(a,course);
  if (a.assignmentGroup) return `과제 그룹 ${a.assignmentGroup.tasks.length}개 · ${a.assignmentGroup.allocation === 'unconfirmed' ? '배점 확인 필요' : a.assignmentGroup.allocation === 'equal' ? '균등 배점' : '개별 배점'}`;
  return taskProgressText(a.progress, a.maxScore);
}

function taskProgressText(progress: AssessmentProgress | null, maxScore: number): string {
  if (!progress) return '확인 필요';
  switch (progress.status) {
    case 'scheduled': return '예정';
    case 'awaiting_grade': return '채점 대기';
    case 'graded': return `점수 확정 ${progress.score} / ${maxScore}`;
    case 'zero_confirmed': return `0점 확정 · ${progress.reason === 'absent' ? '미응시' : '미제출'}`;
  }
}

export function CourseList() {
  const [tab, setTab] = useState<'summary' | 'records' | 'settings'>('summary');
  const [store, setStore] = useState<StoreState>(EMPTY);
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ course: ManagedCourse; isNew: boolean } | null>(null);
  const [live,setLive]=useState<ManagedCourse|null>(null);
  const [editingInvalid,setEditingInvalid]=useState(false);
  const storeRef=useRef(store);
  useEffect(()=>{storeRef.current=store;},[store]);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const detailRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setStore(readStore()); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (selectedId && !editor) detailRef.current?.focus(); }, [selectedId, editor]);
  useEffect(() => {
    if (store.mode !== 'migration' || reviewedIds.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [store.mode, reviewedIds.length]);

  const reload = () => {
    if ((editor || reviewedIds.length > 0) && !window.confirm('다시 불러오면 저장하지 않은 편집·이전 검토 내용이 사라집니다. 계속할까요?')) return;
    setStore(readStore()); setEditor(null); setLive(null); setEditingInvalid(false); setSelectedId(null); setTab('summary'); setReviewedIds([]); setConfirmDelete(false); setNotice('목록을 다시 불러왔습니다.');
  };
  const fail = (errors: string[]) => { setStore((s) => ({ ...s, errors })); setNotice(''); };
  const persist = (next: ManagedCourse[], message: string, confirmedAssignmentChanges = false, confirmedAttendanceChanges = false): boolean => {
    if (store.mode !== 'ready') return false;
    // Do not skip legacy records created in another tab while this empty page was open.
    if (store.snapshot === null) {
      const v1 = loadCourses();
      if (!v1.ok) { fail([v1.error]); return false; }
      if (v1.courses.length > 0) { fail(['기존 v1 과목이 발견되었습니다. 목록을 다시 불러와 이전 검토를 먼저 완료해 주세요.']); return false; }
    }
    const saved = saveManagedCourses(next, store.snapshot, undefined, confirmedAssignmentChanges, confirmedAttendanceChanges);
    if (!saved.ok) { fail(saved.errors); return false; }
    const updated={ ...store, courses: next, snapshot: saved.value.snapshot, errors: [] };
    storeRef.current=updated;setStore(updated);
    setNotice(message);
    return true;
  };
  const selected = live?.id===selectedId?live:store.courses.find((c) => c.id === selectedId);
  const autoPersist=(course:ManagedCourse,assignment:boolean,attendance:boolean)=>{
    const current=storeRef.current;
    if(current.mode!=='ready'||!current.courses.some((c)=>c.id===course.id))return false;
    const next=current.courses.map((c)=>c.id===course.id?course:c);
    const saved=saveManagedCourses(next,current.snapshot,undefined,assignment,attendance);
    if(!saved.ok){setNotice(saved.errors.join(' '));return false;}
    const updated={...current,courses:next,snapshot:saved.value.snapshot,errors:[]};storeRef.current=updated;setStore(updated);setNotice('');return true;
  };
  const preview = store.preview;
  const migrationReady = preview !== null && preview.courses.every((c) => reviewedIds.includes(c.id) && c.assessments.every((a) => a.assignmentGroup || a.id === (c.attendanceEstimate ? c.attendanceEstimate.assessmentId : c.simpleAttendance?.assessmentId ?? c.attendanceManagement?.assessmentId) || a.progress !== null));

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-4">
        {!selected ? <SectionTitle title="내 수강 과목" hint="이 브라우저에 저장됩니다. 과목을 선택해 기록을 이어가세요." /> : null}
        {notice ? <p role="status" className="mb-3 text-[13px]">{notice}</p> : null}
        {store.errors.length > 0 ? <div role="alert" className="mb-3 rounded-xl bg-[var(--e-surface-2)] p-3 text-[13px]"><ul>{store.errors.map((e, i) => <li key={i}>{e}</li>)}</ul><button type="button" className={buttonClass + ' mt-2'} onClick={reload}>목록 다시 불러오기</button></div> : null}
        {store.mode === 'loading' ? <p role="status" className="text-[13px]">저장된 과목을 불러오는 중입니다.</p> : null}

        {store.mode === 'migration' && preview && !editor ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-[15px] font-semibold">기존 과목 이전 검토</h3>
            <p className="text-[13px]">기존 점수와 반영비율을 보존했습니다. 각 과목을 검토하고 불명확한 진행 상태를 지정해 주세요. 마지막 이전 버튼을 누를 때만 v2에 저장하며 v1 원본은 변경하거나 삭제하지 않습니다.</p>
            <ul className="flex flex-col gap-3">
              {preview.courses.map((course) => (
                <li key={course.id} className="rounded-xl border border-[var(--e-border)] p-3">
                  <p className="text-[14px] font-semibold">{course.name} · {reviewedIds.includes(course.id) ? '검토 완료' : '검토 필요'}</p>
                  <ul className="my-2 space-y-1 text-[12px]">{course.assessments.map((a) => <li key={a.id}>{a.name} · {points(a.weight * 100)}% · {progressText(a, course)}</li>)}</ul>
                  {course.attendance ? <p className="mb-2 text-[12px] text-[var(--e-muted)]">기존 출결 장부는 원형대로 보존합니다.{course.attendanceManagement ? ' 새 출석 기록과 중복 적용하지 않습니다.' : ' 기록 기반 출석 관리로 전환하려면 직접 확인해 주세요.'}</p> : null}
                  <button type="button" className={buttonClass} onClick={() => { setEditor({ course, isNew: false }); setNotice(''); }}>이 과목 검토하기</button>
                </li>
              ))}
            </ul>
            <p className="text-[12px]">검토 완료 {reviewedIds.length} / {preview.courses.length}과목. 기존 과목 이전을 마치면 새 과목을 추가할 수 있습니다.</p>
            <button type="button" className={buttonClass + ' bg-[var(--e-accent)] text-white'} disabled={!migrationReady} onClick={() => {
              if (!migrationReady) return;
              const saved = saveV1Migration(preview);
              if (!saved.ok) { fail(saved.errors); return; }
              setStore({ mode: 'ready', courses: preview.courses, snapshot: saved.value.snapshot, preview: null, errors: [] });
              setReviewedIds([]); setNotice('v2 이전을 완료했습니다. 기존 v1 원본은 보존되어 있습니다.');
            }}>확인한 과목을 v2로 이전</button>
          </div>
        ) : null}

        {store.mode === 'ready' && !editor && !selected ? (
          <>
            {!store.courses.length ? <p className="mb-3 text-[13px] text-[var(--e-muted)]">등록된 과목이 없습니다. 첫 과목을 추가하고 평가항목과 진행 상태를 설정해 보세요.</p> : (
              <ul className="mb-3 flex flex-col gap-2">{store.courses.map((course) => <li key={course.id}><button type="button" className="w-full rounded-xl border border-[var(--e-border)] p-3 text-left focus-visible:outline-2" onClick={() => { setSelectedId(course.id); setTab('summary'); setConfirmDelete(false); setNotice(''); }}><span className="block break-words text-[14px] font-semibold">{course.name}</span><span className="text-[12px] text-[var(--e-muted)]">{course.professor || '교수명 미입력'} · {course.credits}학점 · 평가항목 {course.assessments.length}개 · 요약 보기</span></button></li>)}</ul>
            )}
            <button type="button" className={buttonClass} onClick={() => { setEditor({ course: createCourse(), isNew: true }); setNotice(''); }}>+ 과목 추가</button>
          </>
        ) : null}
        {selected ? (
          <div className="flex flex-col gap-3">
            <h3 ref={detailRef} tabIndex={-1} className="break-words text-[22px] font-bold outline-none">{selected.name}</h3>
            <p className="text-[13px]">{selected.credits}학점 · {selected.semester ? selected.semester.replace('-1', '년 1학기').replace('-2', '년 2학기').replace('-S', '년 여름학기').replace('-W', '년 겨울학기') : '학기 미설정'}{selected.professor ? ` · ${selected.professor}` : ''}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass} onClick={() => { if (editor && (editingInvalid||notice) && !window.confirm('아직 저장되지 않은 편집값이 있습니다. 임시 복구가 불가능한 환경에서는 잃을 수 있습니다. 목록으로 돌아갈까요?')) return; setEditor(null); setLive(null); setEditingInvalid(false); setSelectedId(null); setTab('summary'); setConfirmDelete(false); }}>과목 목록으로</button>
              {tab === 'settings' ? <button type="button" className={buttonClass} onClick={() => setConfirmDelete(true)}>과목 삭제</button> : null}
            </div>
            <nav aria-label="과목 화면" className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--e-surface-2)] p-1">
              {(['summary', 'records', 'settings'] as const).map((key, index) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} className={buttonClass + (tab === key ? ' bg-[var(--e-surface)] text-[var(--e-accent)]' : ' border-transparent')} onClick={() => { setTab(key); if (key !== 'summary' && !editor) setEditor({ course: selected, isNew: false }); setConfirmDelete(false); }}>{['요약', '기록', '설정'][index]}</button>)}
            </nav>
            {editor && tab === 'summary' ? <p className="text-[12px]" role="status">{editingInvalid?'입력 확인이 필요해 마지막 유효한 값으로 계산 중입니다. 편집값은 기록·설정에 유지됩니다.':'유효한 편집값으로 실시간 계산합니다. 저장 상태는 기록·설정에서 확인하세요.'}</p> : null}
            {confirmDelete ? <div className="rounded-xl bg-[var(--e-surface-2)] p-3 text-[13px]"><p>{selected.name}과 평가항목·세부 과제·출석 기록을 모두 삭제할까요? 삭제 후 되돌릴 수 없습니다.</p><div className="mt-2 flex gap-2"><button type="button" className={buttonClass} onClick={() => { if (persist(store.courses.filter((c) => c.id !== selected.id), '과목을 삭제했습니다.', true, true)) { setEditor(null); setLive(null); setEditingInvalid(false); setSelectedId(null); setTab('summary'); setConfirmDelete(false); } }}>삭제 확인</button><button type="button" className={buttonClass} onClick={() => setConfirmDelete(false)}>삭제 취소</button></div></div> : null}
          </div>
        ) : null}
      </Card>

      {editor ? <div hidden={!!selected && tab === 'summary'}><CourseEditor key={editor.course.id} course={editor.course} isNew={editor.isNew} mode={tab === 'records' ? 'records' : 'settings'} migration={store.mode === 'migration'} onAutoSave={autoPersist} onPreview={(course,invalid)=>{if(course)setLive(course);setEditingInvalid(invalid);}} onCancel={() => { setEditor(null); setLive(null);setTab('summary'); }} onSave={(course, confirmedAssignmentChanges, confirmedAttendanceChanges) => {
        if (store.mode === 'migration' && preview) {
          setStore({ ...store, preview: { ...preview, courses: preview.courses.map((c) => c.id === course.id ? course : c) }, errors: [] });
          setReviewedIds((ids) => ids.includes(course.id) ? ids : [...ids, course.id]);
          setEditor(null); setNotice('이 과목의 검토 내용을 반영했습니다. 아직 저장되지 않았습니다. 전체 이전 버튼을 눌러 주세요.');
          return;
        }
        const next = editor.isNew ? [...store.courses, course] : store.courses.map((c) => c.id === course.id ? course : c);
        if (persist(next, '과목을 저장했습니다.', confirmedAssignmentChanges, confirmedAttendanceChanges)) { setEditor(null); setSelectedId(course.id); setTab('summary'); setConfirmDelete(false); }
      }} /></div> : null}

      {selected && tab === 'summary' ? (
        <>
          <RecordedBalance course={selected} />
          <CurrentOutlook course={selected} />
          <GradeGoalPlanner key={selected.id} course={selected} />
          <details className="rounded-xl border border-[var(--e-border)] p-3"><summary className="cursor-pointer text-[13px] font-semibold">출석 기록 · 결석 여유 {estimateAttendance(selected).remainingAllowance}회{estimateAttendance(selected).caution==='below_reference'?' · ⚠ 기준 미달 추정':estimateAttendance(selected).caution==='boundary'?' · 허용 경계':estimateAttendance(selected).caution==='warning'?' · 주의':''}</summary><div className="mt-3"><AttendanceEstimateCard course={selected} /></div></details>
          <div className="grid grid-cols-2 gap-2" aria-label="평가 진행 요약">{selected.assessments.map((a) => <button key={a.id} type="button" className="rounded-xl border border-[var(--e-border)] bg-[var(--e-surface)] p-4 text-left focus-visible:outline-2" onClick={() => { setTab('records'); if (!editor) setEditor({ course: selected, isNew: false }); }}><span className="text-[14px] font-semibold"><span aria-hidden="true" className="mr-2">{a.id === prepareAttendanceEstimate(selected).value.assessmentId ? '✓' : a.assignmentGroup || /과제/.test(a.name) ? '▤' : '✎'}</span>{a.name}<span className="ml-2 text-[12px] font-normal text-[var(--e-muted)]">{points(a.weight * 100)}%</span></span><span className="mt-2 block text-[13px]">{assessmentSummary(a, selected)}</span></button>)}</div>
        </>
      ) : null}
    </div>
  );
}

function CurrentOutlook({course}:{course:ManagedCourse}) {
  const view=forecastPresentation(course);
  const rows=(items:{label:string;value:string}[])=><dl className="divide-y divide-[var(--e-border)]">{items.map((r,i)=><div key={i} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2"><dt className="break-words text-[var(--e-muted)]">{r.label}</dt><dd className="break-words font-medium">{r.value}</dd></div>)}</dl>;
  return <Card className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[15px] font-semibold">현재 성적 전망</h3><span className="rounded-full bg-[var(--e-surface-2)] px-2 py-1 text-[12px] text-[var(--e-muted)]">{view.status}</span></div>
    {view.projectedScore!==null?<p className="mt-2 text-[13px]" data-outlook="score">출석 반영 예상 총점 <strong>{points(view.projectedScore)}점</strong></p>:null}
    {view.grade?<><p className="mt-3 flex items-baseline gap-2"><span className="text-[13px] text-[var(--e-muted)]">예상</span><strong data-outlook="grade" className="text-[40px] leading-tight text-[var(--e-secured)]">{view.grade}</strong></p><p className="mt-1 text-[13px]">{view.allRecorded?'입력한 결과로 살펴본 전망이에요. 최종 등급은 달라질 수 있어요.':view.relative?'남은 시험도 지금의 반 내 위치를 유지한다면':'남은 평가도 지금까지의 득점률을 유지한다면'}</p>{view.boundary?<p className="mt-2 text-[12px]">등급 경계 근처라 결과가 달라질 수 있어요.</p>:view.manyAssumptions?<p className="mt-2 text-[12px] text-[var(--e-muted)]">여러 가정이 포함된 전망이에요.</p>:null}</>:<div className="mt-3"><p className="text-[14px] font-semibold">아직 예상 등급을 계산하기 어려워요.</p><p className="mt-2 text-[13px]">{view.nextInfo}</p></div>}
    {view.relativePosition?<p className="mt-2 text-[12px] text-[var(--e-muted)]" data-outlook="relative-position">{view.relativePosition}</p>:null}
    {view.highlights.length?<ul className="mt-3 space-y-2 border-t border-[var(--e-border)] pt-3" aria-label="전망 핵심 근거">{view.highlights.map((r,i)=><li key={i} className="flex items-start gap-2 text-[13px]"><span className="shrink-0 rounded bg-[var(--e-surface-2)] px-1.5 py-0.5 text-[12px]">{r.kind}</span><span className="min-w-0 break-words">{r.label} <strong className="font-medium">{r.value.split(' · ')[0]}</strong></span></li>)}</ul>:null}
    <details className="group mt-3 border-t border-[var(--e-border)] pt-2"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">왜 이 전망인가요?<span aria-hidden="true" className="text-[var(--e-muted)] group-open:rotate-180">⌄</span></summary>
      <div className="mt-2 space-y-4 text-[13px] leading-relaxed">
        {view.fallback?<dl className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[var(--e-surface-2)] p-3"><div><dt className="text-[12px]">확정 기록 기준 범위</dt><dd className="mt-1 text-[18px] font-bold">{points(view.fallback.low)}~{points(view.fallback.high)}점</dd></div><div><dt className="text-[12px]">아직 확보하지 않은 배점</dt><dd className="mt-1 text-[18px] font-bold">{points(view.fallback.remaining)}점</dd></div></dl>:<p className="mt-2 text-[13px]">평가비율·진행 상태를 확인하면 점수 범위를 볼 수 있어요.</p>}
        <section><h4 className="font-semibold">① 확정된 정보</h4>{view.confirmed.length?rows(view.confirmed):<p className="mt-2 text-[var(--e-muted)]">확정 점수 기록이 아직 없어요.</p>}<details className="mt-1"><summary className="min-h-9 cursor-pointer text-[12px]">평가항목 반영비율</summary>{rows(view.weights)}</details></section>
        <section><h4 className="font-semibold">② 예측에 사용한 가정</h4>{view.assumed.length?rows(view.assumed):<p className="mt-2 text-[var(--e-muted)]">남은 평가 점수를 추가로 가정하지 않았어요.</p>}{view.relative?<p className="mt-2 text-[12px] text-[var(--e-muted)]">현재 출석 감점을 반영해 비교합니다. 다른 학생은 출석 만점이라는 가정이며 실제 등급은 달라질 수 있어요.</p>:null}</section>
        <section><h4 className="font-semibold">③ 아직 알 수 없는 정보</h4>{view.unknown.length?rows(view.unknown):<p className="mt-2 text-[var(--e-muted)]">교수님의 최종 평가·원점수 환산 결과</p>}</section>
        {view.familyProbabilities.length?<section><h4 className="font-semibold">통계 자료 기반 계열 확률</h4>{rows(view.familyProbabilities)}<p className="mt-1 text-[12px] text-[var(--e-muted)]">기존 통계 모델의 조건부 결과이며 실제 등급 보장이 아닙니다. 공식 A/B 상한과 +/0 분할 가정은 구분합니다.</p></section>:null}
        <details><summary className="min-h-9 cursor-pointer text-[12px]">계산 방식 더 보기</summary><ul className="mt-2 list-disc space-y-2 pl-4 text-[12px]">{view.relative?<><li>반 평균과 시험 만점에 맞는 점수 분포를 가정합니다. 실제 등수나 등급 확률을 측정한 결과가 아닙니다.</li><li>A·B 배분 상한과 +/0 절반 배분은 실제 교수자 배분과 다를 수 있습니다.</li></>:<li>확정 점수는 유지하고 남은 시험·과제에 완료한 평가의 득점률을 적용합니다. 같은 종류 기록이 없으면 전체 확정 평가를 참고합니다.</li>}<li>완료한 과제가 모두 만점이면 남은 과제도 만점으로 가정할 수 있습니다. 보장 점수가 아니며 실제 과제 난이도에 따라 달라집니다.</li><li>채점 대기는 이미 치른 평가입니다. 예상 값을 실제 기록으로 저장하거나 성적 막대에 합산하지 않습니다.</li></ul></details>
      </div>
    </details>
    <button type="button" className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl bg-[var(--e-surface-2)] px-3 py-2 text-left focus-visible:outline-2" onClick={()=>{const target=document.getElementById(`grade-goal-${course.id}`);target?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target?.focus({preventScroll:true});}}><span><span className="block text-[13px] font-semibold">목표 학점이 더 높다면?</span><span className="block text-[12px] text-[var(--e-muted)]">목표를 고르고 필요한 점수를 확인하세요.</span></span><span aria-hidden="true">→</span></button>
  </Card>;
}

function GradeGoalPlanner({course}:{course:ManagedCourse}) {
  const [target,setTarget]=useState(resolvePolicy(course).kind==='pass_fail'?'P':'A0');
  const [strategy,setStrategy]=useState('balanced');
  const {plan,relative}=gradeActionPlan(course,target);
  const planned=plan.kind==='plan'?plan:null;
  const selected=planned?.strategies.find((s)=>s.key===strategy)??planned?.strategies[0];
  const exam=selected?.rows.find((r)=>/기말|final/i.test(r.name))??selected?.rows.find((r)=>r.kind==='exam');
  const relativePlan=relative?.kind==='plan'?relative:null;
  const attendance=estimateAttendance(course);
  const e=prepareAttendanceEstimate(course).value;
  const extra=estimateAttendance({...course,attendanceEstimate:{...e,absences:e.absences+1}});
  const currentProjection=simulateCourse(course),extraProjection=simulateCourse(course,{extraAbsences:1});
  const currentHp=summarizeScore(course);
  const additionalAbsenceLoss=currentProjection.ok&&extraProjection.ok?Math.max(0,extraProjection.value.attendanceDeduction-currentProjection.value.attendanceDeduction):null;
  const tasks=planningUnits(course).units.filter((u)=>u.kind==='assignment');
  const ready=!!relativePlan||!!planned;
  const impossible=relative?.kind==='impossible'||plan.kind==='impossible';
  const rowClass='flex items-start gap-3 rounded-xl border border-[var(--e-border)] p-3';
  return <div id={`grade-goal-${course.id}`} tabIndex={-1} className="scroll-mt-4 rounded-xl focus-visible:outline-2"><Card className="p-4">
    <SectionTitle title="나의 목표 학점" hint="목표를 고르고, 다음 할 일을 확인하세요." />
    <div role="group" aria-label="목표 학점" className="flex flex-wrap gap-2">{(resolvePolicy(course).kind==='pass_fail'?['P']:['A+','A0','B+','B0','C+','C0','D+','D0']).map((g)=><button key={g} type="button" aria-pressed={target===g} className={'min-h-11 min-w-12 rounded-xl border px-3 text-[15px] font-bold focus-visible:outline-2 '+(target===g?'border-[var(--e-secured)] bg-[var(--e-secured)] text-white':'border-[var(--e-border)] bg-[var(--e-surface)]')} onClick={()=>setTarget(g)}>{g}</button>)}</div>
    <div className="mt-4 rounded-2xl bg-[var(--e-surface-2)] p-4" aria-live="polite">
      {currentHp.ok&&currentHp.value.hp!==null?<p className="mb-2 text-[12px]" data-planner="current-score">현재 HP {points(currentHp.value.hp)} / 100 · 출석 기록 반영</p>:null}
      <div className="flex items-center justify-between gap-2"><p className="text-[13px] font-semibold">{target} 목표</p><span className={'rounded-full px-2 py-1 text-[11px] font-semibold '+(impossible?'bg-red-50 text-red-800':'bg-[var(--e-surface)] text-[var(--e-muted)]')}>{ready?'조건부 도전':impossible?'목표 재검토':plan.kind==='already'?'유지 목표':'정보 확인'}</span></div>
      {relativePlan?<><p className="mt-3 text-[12px]">{relativePlan.name} 참고 목표 · 시험 원점수</p><p data-relative-goal="score" className="mt-1 text-[38px] font-bold leading-tight text-[var(--e-secured)]">약 {relativePlan.required}<span className="ml-1 text-[15px] font-normal text-[var(--e-muted)]">/ {relativePlan.maxScore}점</span></p><p className="mt-2 text-[12px]">가정에 따른 참고값이며, 이 점수로 {target}를 보장하지 않아요.</p></>:planned?<><p className="mt-3 text-[12px]">남은 평가에서 채울 점수</p><p data-planner="needed" className="mt-1 text-[38px] font-bold leading-tight text-[var(--e-secured)]">{points(planned.bestNeeded)}{planned.waiting>0?`~${points(planned.needed)}`:''}<span className="ml-1 text-[15px] font-normal">점</span></p><p className="mt-2 text-[12px]">남은 배점 {points(planned.capacity)}점 기준 · 현재 출석 기록 반영</p></>:<p data-planner="message" className="mt-3 text-[13px]">{relative?.message??plan.message}</p>}
    </div>
    {ready?<section className="mt-5"><h4 className="mb-2 text-[14px] font-semibold">지금 해야 할 일</h4>
      {planned?<div className="mb-3 flex flex-wrap gap-2">{planned.strategies.map((s)=><button key={s.key} type="button" aria-pressed={s.key===selected?.key} className={buttonClass+(s.key===selected?.key?' text-[var(--e-secured)]':'')} onClick={()=>setStrategy(s.key)}>{s.label}</button>)}</div>:null}
      <div className="space-y-2">
        {relativePlan||exam?<div className={rowClass}><span aria-hidden="true" className="text-[20px] text-[var(--e-secured)]">✎</span><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">{relativePlan?.name??exam?.name}</p><p className="mt-1 text-[20px] font-bold">{relativePlan?`약 ${relativePlan.required} / ${relativePlan.maxScore}점`:exam?`${points(exam.low)}${exam.high-exam.low>1e-8?`~${points(exam.high)}`:''} / ${exam.maxScore}점`:''}</p><p className="mt-1 text-[12px] text-[var(--e-muted)]">{relativePlan?'현재 평균 가정에서의 도전 점수':exam&&exam.high>exam.maxScore?'만점 초과 조건 · 다른 전략을 확인하세요':selected?.assumption}</p></div></div>:null}
        {tasks.length?<div className={rowClass}><span aria-hidden="true" className="text-[20px] text-[var(--e-secured)]">▤</span><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">남은 과제 {tasks.length}개</p>{relative?<><p className="mt-1 text-[16px] font-bold">빠짐없이 제출하기</p><p className="mt-1 text-[12px] text-[var(--e-muted)]">제출 권장 · 등급 상승 효과는 계산하지 않아요.</p></>:<ul className="mt-1 space-y-1 text-[13px]">{selected?.rows.filter((u)=>u.kind==='assignment').map((u)=><li key={u.taskId??u.assessmentId} data-plan-unit={u.taskId??u.assessmentId}>{u.name} <strong>{points(u.low)}{u.high-u.low>1e-8?`~${points(u.high)}`:''} / {u.maxScore}점</strong>{u.high>u.maxScore?' · 만점 초과':''}</li>)}</ul>}</div></div>:null}
        <div className={rowClass}><span aria-hidden="true" className="text-[20px] text-[var(--e-secured)]">✓</span><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold">출석</p><p className="mt-1 text-[16px] font-bold">{attendance.maximum>0&&additionalAbsenceLoss!==null?`추가 결석 1회 · 약 −${points(additionalAbsenceLoss)}점`:'추가 결석 피하기'}</p><p className="mt-1 text-[12px] text-[var(--e-muted)]">{extra.caution==='below_reference'?'간이 출석 기준 미달 주의 · 실제 응시 제한은 확인 필요':extra.caution==='boundary'?'한 번 더 결석하면 간이 출석 기준 경계':'현재 출석 기록 반영 · 등급은 경계를 넘을 때 달라져요.'}</p></div></div>
      </div></section>:null}
    <details className="mt-4 border-t border-[var(--e-border)] pt-3"><summary className="min-h-11 cursor-pointer text-[13px] font-semibold">계산 근거 보기</summary><div className="mt-2 space-y-3 text-[12px] leading-relaxed">
      {relativePlan?<><dl className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--e-surface-2)] p-3"><div><dt className="text-[var(--e-muted)]">시험 만점</dt><dd className="font-semibold">{relativePlan.maxScore}점 · 원점수</dd></div><div><dt className="text-[var(--e-muted)]">{relativePlan.assumedMean?'가정한 반 평균':'입력한 반 평균'}</dt><dd className="font-semibold">{points(relativePlan.mean)}점</dd></div><div><dt className="text-[var(--e-muted)]">목표 구간</dt><dd className="font-semibold">모형상 상위 {points(relativePlan.cut*100)}% 이내</dd></div><div><dt className="text-[var(--e-muted)]">수치 표시</dt><dd>계산 경계를 정수로 올림</dd></div></dl><p>기말 평균이 없으면 확정 시험들의 반 평균을 만점 대비 비율로 바꿔 반영비율로 가중 평균한 뒤, 기말 만점에 환산합니다. 시험별 상대 위치를 반영비율로 합치며 다른 미완료 시험은 현재 상대 위치를 유지합니다.</p></>:<p>{relative?.message??plan.message}</p>}
      {relative?<><h5 className="font-semibold">예측에 사용한 가정</h5><ul className="list-disc space-y-2 pl-4"><li>시험 평균과 만점만으로 최대엔트로피 분포를 가정합니다. 실제 반 등수나 최종 성적 확률이 아닙니다.</li><li>설정한 A·B 배분 상한을 모두 사용하며 각 계열의 +/0는 반반으로 나눕니다.</li><li>다른 학생의 출석은 만점으로 두고 내 출석 감점을 시험 점수로 환산해 비교합니다. 실제 등급을 보장하는 기준은 아닙니다.</li></ul></>:<p>{selected?.assumption} · 채점 대기는 0~만점 결과 범위로 남기며, 만점 초과 조건은 달성할 수 없습니다.</p>}
      <p>출석은 만점에서 기록한 결석·지각만큼 차감합니다. 현황·전망·목표 계산에 같은 점수를 사용하며, 실제 교수자 감점 규칙은 다를 수 있습니다.</p>
    </div></details>
  </Card></div>;
}

function RecordedBalance({ course }: { course: ManagedCourse }) {
  const result = computeManagedBalance(course);
  if (!result.ok) return <Card className="p-4"><p role="alert" className="text-[13px]">확인 필요: {result.errors.join(' ')}</p></Card>;
  const summary = summarizeScore(course, result);
  if (!summary.ok) return <Card className="p-4"><p role="alert" className="text-[13px]">확인 필요: {summary.errors.join(' ')}</p></Card>;
  const { hp, lostHp, attainableGrade, confirmedMaximum, attendanceDeduction, attendanceMaximum, attendanceRule, attendanceDeductionSource } = summary.value;
  const { balance, complete, review } = result.value;
  const total = Object.values(balance).reduce((sum, n) => sum + n, 0);
  return (
    <Card className="p-4">
      <SectionTitle title="성적 HP" hint="현재 최고 가능 총점 · 잃은 점수만큼 감소해요" />
      <div aria-live="polite" className="mb-3">
        <p className="text-[36px] font-bold tabular-nums" data-score="hp">{hp===null?'확인 필요':points(hp)}<span className="ml-2 text-[14px] font-normal text-[var(--e-muted)]">/ 100</span></p>
      </div>
      <div className="mb-3 h-7 overflow-hidden rounded-full bg-[var(--e-surface-2)]" role="progressbar" aria-label="성적 HP · 현재 최고 가능 점수" aria-valuemin={0} aria-valuemax={100} aria-valuenow={hp??undefined} aria-valuetext={hp===null?'기록 확인 필요':`${points(hp)} / 100 HP`}>
        <div data-hp-fill className="h-full rounded-full bg-[var(--e-secured)]" style={{width:`${hp??0}%`}} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-[13px]" aria-label="HP 요약">
        <div><dt className="text-[var(--e-muted)]">현재 최고 가능 점수</dt><dd className="mt-1 font-semibold tabular-nums" data-score="maximum">{hp===null?'확인 필요':`${points(hp)}점`}</dd></div>
        <div><dt className="text-[var(--e-muted)]">잃은 점수</dt><dd className="mt-1 font-semibold tabular-nums" data-score="lost-hp">{lostHp===null?'확인 필요':`${points(lostHp)}점`}</dd></div>
      </dl>
      {attendanceMaximum>0?<p className="mt-3 text-[12px] text-[var(--e-muted)]" data-score="attendance-deduction" data-attendance-source={attendanceDeductionSource}>출석 차감 {points(attendanceDeduction)} HP · {attendanceDeductionSource==='confirmed-record'?'기존 확정 기록 우선':`설정 규칙 기준 (${attendanceRule.totalSessions}회, 지각 ${attendanceRule.latenessPerAbsence}회=결석 1회)`}</p>:null}
      {attainableGrade?<p className="mt-3 text-[13px]" data-hp="attainable-grade">{attainableGrade==='F'?'현재 HP로는 설정된 통과 기준에 닿지 않습니다.':`HP 기준 도전 가능: ${attainableGrade} · 남은 평가 만점 조건`}</p>:null}
      {!complete ? <p role="status" className="mt-3 text-[13px]">{review.unclassifiedPoints>0?`미분류 ${points(review.unclassifiedPoints)}점 · 진행 상태·배점은 기록·설정에서 확인하세요.`:'정확한 점수 계산에 필요한 규칙을 상세 설정에서 확인하세요.'}</p> : null}
      <details className="mt-3"><summary className="cursor-pointer text-[12px] font-semibold">계산 근거와 평가항목별 내역</summary>
      <p className="mt-2 text-[12px]" data-outlook="maximum">확정 기록 기준 최고 {confirmedMaximum===null?'확인 필요':`${points(confirmedMaximum)}점`} · 출석 감점은 현재 점수에 반영되어 있습니다.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2" aria-label="4영역 성적 현황">{AREAS.map(({key, label}) => <div key={key}><dt className="text-[12px]">{label}</dt><dd data-area={key}>{points(balance[key])}점</dd></div>)}</dl>
      <p className="mt-2 text-[12px]">결과 대기 {points(balance.ungraded)}점은 시험·제출을 마치고 채점만 기다리는 배점이고, 앞으로 치를 평가 {points(balance.remaining)}점은 아직 진행하지 않은 배점입니다. 화면에서만 합치며, 계산에서는 구분합니다.</p>
      <p className="mt-3 text-[13px]">네 영역 합계: {points(total)}점 {complete ? '· 100점 검증 완료' : '· 미분류 배점 별도'}</p>
      {(result.value.finalDeduction ?? 0) > 0 ? <p className="mt-2 text-[13px]">별도 최종 성적 감점 {points(result.value.finalDeduction!)}점은 출석 항목 내부 상실에 중복 합산하지 않았습니다.</p> : null}
      {result.value.netFinalScore !== null && result.value.netFinalScore !== undefined ? <p className="mt-2 text-[13px] font-semibold">모든 평가 확정 후 계산 점수: {points(result.value.netFinalScore)}점 (별도 최종 감점 반영)</p> : null}
      {review.assessmentIds.length > 0 ? <p role="status" className="mt-2 text-[13px]">배점 또는 진행 상태 확인 필요: {review.assessmentIds.length}개 항목, {points(review.unclassifiedPoints)}점. 이 배점은 예정·채점 대기·0점 중 어느 것으로도 추정하지 않았습니다.</p> : null}
      {review.attendanceLedgerPreserved ? <p className="mt-2 text-[13px]">확인 필요: 기존 출결 장부는 보존되어 있지만 이 4영역에는 별도 장부 감점을 적용하지 않았습니다. 출석 기록 검토 전까지 최종 성적으로 단정할 수 없습니다.</p> : null}
      <p className="mt-2 text-[12px] text-[var(--e-muted)]">미확정 점수는 평가를 마치고 결과를 기다리는 배점입니다. 남은 배점은 아직 진행하지 않은 평가입니다. 숫자는 표시할 때만 반올림합니다.</p>
      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-semibold">평가항목별 배점 내역</summary>
        <ul className="mt-3 flex flex-col gap-3">{course.assessments.map((a) => {
          const item = result.value.items.find((entry) => entry.assessmentId === a.id);
          return <li key={a.id} className="rounded-xl border border-[var(--e-border)] p-3" data-assessment-id={a.id}>
            <p className="break-words text-[13px] font-semibold">{a.name} · {points(a.weight * 100)}% · {progressText(a, course)}</p>
            {item ? <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">{AREAS.map(({ key, label }) => <div key={key}><dt className="text-[var(--e-muted)]">{label}</dt><dd className="tabular-nums" data-item-area={key}>{points(item.balance[key])}점</dd></div>)}</dl> : null}
            {item && !item.complete ? <p className="mt-2 text-[12px]">확인 필요: 배점·진행 상태·감점 규칙을 확인해 주세요. 미분류 배점 {points(item.unclassifiedPoints)}점은 위 네 영역에 추정 배정하지 않았습니다.</p> : null}
            {a.assignmentGroup ? <AssignmentDetails assessment={a} /> : null}
          </li>;
        })}</ul>
      </details>
      </details>
    </Card>
  );
}

function AssignmentDetails({ assessment }: { assessment: ManagedAssessment }) {
  const group = assessment.assignmentGroup;
  const result = computeAssignmentBalance(assessment);
  if (!group || !result.ok) return null;
  return <details className="mt-3">
    <summary className="cursor-pointer text-[13px] font-semibold">개별 과제 {group.tasks.length}개 내역</summary>
    <p className="mt-2 text-[12px] text-[var(--e-muted)]">기존 단일 기록({taskProgressText(assessment.progress, assessment.maxScore)})은 보관되어 있으며 위 점수에 중복 합산하지 않습니다.</p>
    <ul className="mt-2 flex flex-col gap-2">{group.tasks.map((task, index) => {
      const detail = result.value.tasks[index];
      return <li key={task.id}><details className="rounded-lg bg-[var(--e-surface-2)] p-3" data-recorded-task-id={task.id}>
        <summary className="cursor-pointer break-words text-[12px] font-semibold">{task.name} · {taskProgressText(task.progress, task.maxScore)} · {detail.share === null ? '배점 확인 필요' : `내부 ${points(detail.share * 100)}% / 최종 ${points(detail.points!)}점`}</summary>
        {detail.balance ? <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">{AREAS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd data-task-area={key}>{points(detail.balance![key])}점</dd></div>)}</dl> : <p className="mt-2 text-[12px]">배점 확인 필요: 과제 점수를 환산하지 않았습니다.</p>}
      </details></li>;
    })}</ul>
  </details>;
}
