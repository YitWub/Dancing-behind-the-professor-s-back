'use client';

import { CourseRelativePanel, RelativeFields, StatisticsFields, readRelative, readStatistics } from './CourseRelativePanel';
import { CourseGradeSimulation } from './CourseGradeSimulation';
import { CourseGradeBalance } from './CourseGradeBalance';
import { analyzeRelativeOutlook } from '@/lib/dex/course/grade/outlook';
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
  const simulationRecord = record && {
    method: record.method,
    assessments: record.assessments.map(({ id, name, weightPercent, maxScore, result }) =>
      ({ id, name, weightPercent, maxScore, result })),
  };
  const outlook = record?.method === 'relative' ? analyzeRelativeOutlook(record) : null;
  const comparison = outlook?.assessments.find(item => item.difference !== null);
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

  async function save(current: Draft, fields: FormData) {
    setError('');
    const grade: CourseGradeRecord = {
      method: current.method,
      relative: readRelative(fields),
      assessments: current.items.map(item => ({
        statistics: readStatistics(fields, item.id),
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
    {!draft && outlook && <div className="course-sheet space-y-1 p-3">
      <p className="font-semibold">상대평가 전망 · 최종 등급 판단 보류</p>
      {outlook.rank ? <p>공개 종합 등수 {outlook.rank.rank}등 · {outlook.rank.scope}</p>
        : comparison ? <p>{comparison.name} 평균 대비 {new Intl.NumberFormat('ko', { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(comparison.difference ?? 0)}점</p>
        : <p>확정 점수의 반 평균이나 공개 종합 등수를 입력하면 현재 위치를 확인할 수 있어요.</p>}
    </div>}
    {(draft || record) && <p>반영비율 합계 {Number.isFinite(total) ? total + '%' : '확인 필요'} · {total === 100 ? '설정 완료' : total > 100 ? '100% 초과 · 저장할 수 없어요' : '설정 미완성'}</p>}
    {draft ? <form onSubmit={event => { event.preventDefault(); if (!busy) void save(draft, new FormData(event.currentTarget)); }}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">평가 방식<select className={input} value={draft.method} onChange={event => setDraft({ ...draft, method: event.target.value as Draft['method'] })}>
          {Object.entries(GRADING_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <div hidden={draft.method !== 'relative'}><RelativeFields relative={draft.entry.subject.gradeRecord?.relative} /></div>
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
          <div hidden={draft.method !== 'relative'}><StatisticsFields id={item.id}
            statistics={draft.entry.subject.gradeRecord?.assessments.find(saved => saved.id === item.id)?.statistics} /></div>
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
      {record && <details>
        <summary className="cursor-pointer">현재 성적 · 평가항목과 실제 점수</summary>
        <p>평가 방식 · {GRADING_METHODS[record.method]}</p>
        <ul className="space-y-1 break-words">{record.assessments.map(item => {
          const score = confirmedScore(item.result);
          return <li key={item.id}>{item.name} · {item.weightPercent}% · {SCORE_STATES[item.result.status]}{score === undefined ? ' · 만점 ' + item.maxScore + '점' : ' · ' + score + '/' + item.maxScore + '점'}</li>;
        })}</ul>
      </details>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="dex-button" disabled={busy} onClick={start}>{record ? '성적 수정' : '성적 관리 시작'}</button>
        {record?.method === 'relative' && (record.relative || record.assessments.some(item => item.statistics)) &&
          <button type="button" className="dex-button course-danger" disabled={busy} onClick={() => {
            if (!window.confirm('상대평가 통계와 정책만 초기화할까요?')) return;
            const assessments = record.assessments.map(item => {
              const clean = { ...item };
              delete clean.statistics;
              return clean;
            });
            void onSave(entry, { method: record.method, assessments });
          }}>상대평가 정보 초기화</button>}
        {record && <button type="button" className="dex-button course-danger" disabled={busy} onClick={() => {
          if (window.confirm('이 수강 기록의 평가항목과 점수를 초기화할까요?')) void onSave(entry);
        }}>성적 초기화</button>}
      </div>
    </>}
    <div hidden={!!draft} className="space-y-2">
      {record && simulationRecord && <details><summary className="cursor-pointer">목표와 시뮬레이션</summary><CourseGradeSimulation key={JSON.stringify(simulationRecord)} record={record} /></details>}
      {record?.method === 'relative' && <details><summary className="cursor-pointer">상대평가 전망 상세</summary><CourseRelativePanel key={JSON.stringify(record.relative)} record={record} /></details>}
    </div>
  </section>;
}
