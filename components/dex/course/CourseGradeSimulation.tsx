'use client';

import { useState } from 'react';
import { calculateTargetRequirement, simulateCourseGrade } from '@/lib/dex/course/grade/simulation';
import type { CourseGradeRecord } from '@/lib/dex/course/grade-record';

const format = new Intl.NumberFormat('ko', { maximumFractionDigits: 2 });
const control = 'block w-full min-w-0 rounded border p-2';
const gradeLabels = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0'];

export function CourseGradeSimulation({ record }: { record: CourseGradeRecord }) {
  const [target, setTarget] = useState('');
  const [condition, setCondition] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const simulation = simulateCourseGrade(record, Object.fromEntries(
    Object.entries(scores).filter(([, value]) => value.trim() !== '').map(([id, value]) => [id, Number(value)]),
  ));
  const requirement = target.trim() === '' ? null : calculateTargetRequirement(simulation, Number(target));

  return <section className="course-sheet space-y-3 break-words p-3" aria-label="목표 및 시뮬레이션">
    <h4 className="font-semibold">목표 및 시뮬레이션</h4>
    {simulation.status === 'partial' || simulation.status === 'empty' ? <p>평가 비율 설정을 완료하면 목표 점수를 계산할 수 있어요.</p>
      : simulation.status === 'invalid' ? <p>평가 비율·만점·실제 점수를 확인해 주세요.</p> : <>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>목표 환산점수 (0~100점)
          <input className={control} type="number" min="0" max="100" step="any" value={target}
            onChange={event => setTarget(event.target.value)} />
        </label>
        {(record.method === 'absolute' || record.method === 'passFail') && <label>조건부 등급 목표
          <select className={control} value={condition} onChange={event => setCondition(event.target.value)}>
            <option value="">환산점수만 분석</option>
            {(record.method === 'absolute' ? gradeLabels : ['Pass']).map(label => <option key={label}>{label}</option>)}
          </select>
        </label>}
      </div>
      {condition && <p className="course-muted text-sm">목표 환산점수에 {condition} 기준을 직접 입력해 주세요. 사용자 입력 기준에 따른 조건부 분석이며, 출석 등 추가 조건은 반영하지 않아요.</p>}
      <div aria-live="polite" className="space-y-1">
        {simulation.status === 'ready' && <>
          {requirement?.status === 'met' && <p>현재 계산 조건에서 목표 환산점수를 충족해요.</p>}
          {requirement?.status === 'possible' && <p>아직 점수를 지정하지 않은 미확정 평가 전체에서 반영비율 기준 평균 약 {format.format(requirement.requiredRate)}%가 필요해요.{simulation.pendingWeight > 0 ? ' 채점 대기 배점도 포함돼요.' : ''}</p>}
          {requirement?.status === 'impossible' && <p>현재 조건에서 목표 달성이 불가능해요. 최고 가능 점수는 {format.format(simulation.maximum)}점이에요.</p>}
          <p>가능한 최종 환산점수 · {format.format(simulation.minimum)}{simulation.remaining > 0 ? ' ~ ' + format.format(simulation.maximum) : ''}점</p>
          <p className="course-muted text-sm">실제 확보 {format.format(simulation.secured)}점 · 가상 기여 {format.format(simulation.assumed)}점 · 남은 미확정 배점 {format.format(simulation.remaining)}점</p>
        </>}
        {requirement?.status === 'invalid-target' && <p role="alert">목표는 0~100점 사이로 입력해 주세요.</p>}
        {simulation.status === 'invalid-scenario' && <p role="alert">가상 점수는 각 평가의 0점 이상 만점 이하로 입력해 주세요.</p>}
      </div>
      <p className="course-muted text-sm">가상 점수는 임시 입력이에요. 점수를 지정하지 않은 평가에서 0점부터 만점까지 받을 때의 범위를 보여줘요.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {record.assessments.filter(item => item.result.status === 'planned' || item.result.status === 'pending').map(item => <label key={item.id}>
          {item.name} · {item.result.status === 'pending' ? '채점 대기 · 발표 점수 가정' : '예정 · 받을 점수 가정'} (만점 {item.maxScore}점)
          <input className={control} type="number" min="0" max={item.maxScore} step="any"
            value={Object.hasOwn(scores, item.id) ? scores[item.id] : ''} onChange={event => {
              const value = event.target.value;
              setScores(previous => ({ ...previous, [item.id]: value }));
            }} />
        </label>)}
      </div>
      <button className="dex-button" type="button" onClick={() => setScores({})}>가상 점수 초기화</button>
    </>}
  </section>;
}
