'use client';

import { CourseGradeSimulation } from './CourseGradeSimulation';
import { CourseGradeBalance } from './CourseGradeBalance';
import { useState } from 'react';
import { validateCourseGrade } from '@/lib/dex/core/validation';
import { ASSESSMENT_NAMES, GRADING_METHODS, SCORE_STATES, assessmentWeight, confirmedScore } from '@/lib/dex/course/grade-record';
import type { CourseAssessment, CourseGradeRecord } from '@/lib/dex/course/grade-record';
import type { CourseEntry } from '@/lib/dex/course/course';

type DraftItem = Omit<CourseAssessment, 'weightPercent' | 'maxScore' | 'result'> & {
  weight: string; max: string; score: string; status: CourseAssessment['result']['status'];
};
type Draft = { entry: CourseEntry; method: CourseGradeRecord['method']; items: DraftItem[] };
const input = 'block w-full min-w-0 rounded border p-2';

export function CourseGradePanel({ entry, busy, onSave }: {
  entry: CourseEntry;
  busy: boolean;
  onSave: (entry: CourseEntry, grade?: CourseGradeRecord) => Promise<boolean>;
}) {
  const record = entry.subject.gradeRecord;
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState('');
  function start() {
    setError('');
    setDraft({
      entry, method: record?.method ?? 'unknown',
      items: (record?.assessments ?? []).map(item => ({
        id: item.id, name: item.name, weight: String(item.weightPercent), max: String(item.maxScore),
        status: item.result.status, score: item.result.status === 'graded' ? String(item.result.score) : '',
      })),
    });
  }

  function patch(id: string, change: Partial<DraftItem>) {
    setDraft(previous => previous && { ...previous, items: previous.items.map(item => item.id === id ? { ...item, ...change } : item) });
  }

  async function save(current: Draft) {
    setError('');
    const grade: CourseGradeRecord = {
      method: current.method,
      assessments: current.items.map(item => ({
        id: item.id, name: item.name.trim(), weightPercent: item.weight.trim() ? Number(item.weight) : NaN,
        maxScore: Number(item.max), result: item.status === 'graded'
          ? { status: 'graded', score: item.score.trim() ? Number(item.score) : NaN }
          : { status: item.status },
      })),
    };
    try {
      validateCourseGrade(grade);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '성적 입력을 확인해 주세요.');
      return;
    }
    if (await onSave(current.entry, grade)) setDraft(undefined);
  }

  const total = assessmentWeight(draft
    ? draft.items.map(item => ({ weightPercent: Number(item.weight) }))
    : record?.assessments ?? []);
  return <section className="space-y-2 border-t pt-3">
    <h3 className="font-semibold">성적 관리</h3>
    {!draft && <CourseGradeBalance record={record} />}
    <div hidden={!!draft}>{record && <CourseGradeSimulation key={JSON.stringify(record)} record={record} />}</div>
    {(draft || record) && <p>반영비율 합계 {Number.isFinite(total) ? total + '%' : '확인 필요'} · {total === 100 ? '설정 완료' : total > 100 ? '100% 초과 · 저장할 수 없어요' : '설정 미완성'}</p>}
    {draft ? <form onSubmit={event => { event.preventDefault(); if (!busy) void save(draft); }}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">평가 방식<select className={input} value={draft.method} onChange={event => setDraft({ ...draft, method: event.target.value as Draft['method'] })}>
          {Object.entries(GRADING_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <datalist id="course-assessment-names">{ASSESSMENT_NAMES.map(name => <option key={name} value={name} />)}</datalist>
        {draft.items.map((item, index) => <fieldset key={item.id} className="space-y-2 rounded border p-3">
          <legend>평가항목 {index + 1}</legend>
          <label className="block">항목 이름<input className={input} list="course-assessment-names" required maxLength={100} value={item.name} onChange={e => patch(item.id, { name: e.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label>반영비율 (%)<input className={input} required type="number" min="0" max="100" step=".01" value={item.weight} onChange={e => patch(item.id, { weight: e.target.value })} /></label>
            <label>만점<input className={input} required type="number" step="any" value={item.max} onChange={e => patch(item.id, { max: e.target.value })} /></label>
          </div>
          <label className="block">점수 상태<select className={input} value={item.status} onChange={e => patch(item.id, { status: e.target.value as DraftItem['status'], score: '' })}>
            {Object.entries(SCORE_STATES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          {item.status === 'graded' && <label className="block">실제 점수<input className={input} required type="number" min="0" step="any" value={item.score} onChange={e => patch(item.id, { score: e.target.value })} /></label>}
          <button type="button" className="dex-button course-danger" onClick={() => setDraft({ ...draft, items: draft.items.filter(row => row.id !== item.id) })}>항목 삭제</button>
        </fieldset>)}
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="dex-button" disabled={draft.items.length >= 100} onClick={() => setDraft({
            ...draft, items: [...draft.items, { id: crypto.randomUUID(), name: '', weight: '', max: '', score: '', status: 'planned' }],
          })}>평가항목 추가</button>
          <button type="submit" className="dex-button">성적 저장</button>
          <button type="button" className="dex-button" onClick={() => { setDraft(undefined); setError(''); }}>취소</button>
        </div>
      </fieldset>
    </form> : <>
      {record && <>
        <p>평가 방식 · {GRADING_METHODS[record.method]}</p>
        <ul className="space-y-1 break-words">{record.assessments.map(item => {
          const score = confirmedScore(item.result);
          return <li key={item.id}>{item.name} · {item.weightPercent}% · {SCORE_STATES[item.result.status]}{score === undefined ? ' · 만점 ' + item.maxScore + '점' : ' · ' + score + '/' + item.maxScore + '점'}</li>;
        })}</ul>
      </>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="dex-button" disabled={busy} onClick={start}>{record ? '성적 수정' : '성적 관리 시작'}</button>
        {record && <button type="button" className="dex-button course-danger" disabled={busy} onClick={() => {
          if (window.confirm('이 수강 기록의 평가항목과 점수를 초기화할까요?')) void onSave(entry);
        }}>성적 초기화</button>}
      </div>
    </>}
  </section>;
}
