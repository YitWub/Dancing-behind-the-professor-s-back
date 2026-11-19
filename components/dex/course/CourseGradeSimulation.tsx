'use client';

import { estimateRelativeGrade, type RelativeEstimate } from '@/lib/dex/course/grade/relative-estimate';
import { analyzeRelativeOutlook, analyzeRelativeScenario } from '@/lib/dex/course/grade/outlook';
import type { GradeScenario } from '@/lib/dex/course/grade/simulation';
import { useState } from 'react';
import { planCourseTarget } from '@/lib/dex/course/grade/goal';
import { calculateTargetRequirement, simulateCourseGrade } from '@/lib/dex/course/grade/simulation';
import type { CourseGradeRecord } from '@/lib/dex/course/grade-record';

const format = new Intl.NumberFormat('ko', { maximumFractionDigits: 2 });
const control = 'block w-full min-w-0 rounded border p-2';
const gradeLabels = ['A+', 'A0', 'B+', 'B0', 'C+', 'C0', 'D+', 'D0'];

function estimateTitle(result: Extract<RelativeEstimate, { status: 'modeled' }>) {
  switch (result.band) {
    case 'a-cap': return '모형 가정상 A계열 상한 범위';
    case 'ab-cap': return '모형 가정상 A 상한 밖 · A+B 상한 이내';
    case 'outside-ab': return '모형 가정상 A+B 상한 밖';
    case 'sensitive': return '가정에 따라 학점권이 달라져요';
    default: return '모형으로 비교한 상대 위치';
  }
}

function EstimateDetails({ result, enrollment }: { result: Extract<RelativeEstimate, { status: 'modeled' }>; enrollment?: number }) {
  return <details className="space-y-2">
    <summary className="cursor-pointer">모형 가정 자세히 보기</summary>
    <p>평균만 있는 항목은 제한된 점수 범위의 최대엔트로피 분포와 양끝 점수 모형을 비교해요. 표준편차가 있으면 같은 평균·분산을 갖는 두 점 분포를 비교해요.</p>
    <p>여러 항목은 점수 순서가 함께 움직이는 경우와 섞이는 경우를 비교해요. 평균을 모르는 비교 항목은 다른 학생이 내 점수와 같거나 만점인 경우를 사용해요.</p>
    <ul className="space-y-1">{result.scenarios.map(row => <li key={[row.shape, row.dependence, row.missing].join(':')}>
      {row.shape === 'first' ? '기본 분포' : '대안 분포'} · {row.dependence === 'aligned' ? '같은 순서' : '순서 섞기'}
      {result.unknownPeerWeight > 0 && (row.missing === 'same' ? ' · 미확인 항목은 내 점수와 같음' : ' · 미확인 항목은 만점')}
      {' · 나보다 높은 비중부터 동점 포함까지 약 '}{Math.floor(row.above / 5) * 5}~{Math.ceil(row.atOrAbove / 5) * 5}%
    </li>)}</ul>
    <p>반영비율 {result.weight}%를 비교했어요. 비교 통계가 없는 배점 {result.unknownPeerWeight}% · 실제 확정 상실 {format.format(result.lost)}점.</p>
    {enrollment !== undefined && <p>입력 인원 {enrollment}명에서는 한 명이 약 {format.format(100 / enrollment)}%에 해당해요. 실제 배정은 인원과 동점 처리에 따라 달라져요.</p>}
    <p>이 범위는 비교한 가정의 결과예요. 실제 석차, 학점 확률, 검증된 신뢰구간은 제공하지 않아요.</p>
  </details>;
}

export function CourseGradeSimulation({ record, onEdit, busy, sameCohort }: { record: CourseGradeRecord; onEdit: () => void; busy: boolean; sameCohort: boolean }) {
  const [target, setTarget] = useState('');
  const [cutoff, setCutoff] = useState('');
  const [condition, setCondition] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [assumptions, setAssumptions] = useState<Record<string, string>>({});
  const scenario: GradeScenario = Object.fromEntries(
    Object.entries(scores).filter(([, value]) => value.trim() !== '').map(([id, value]) => [id, Number(value)]),
  );
  const simulation = simulateCourseGrade(record, scenario);
  const modelAssumptions = Object.fromEntries(record.assessments.map(item => {
    const optional = (suffix: string) => {
      const value = assumptions[item.id + suffix];
      return value?.trim() ? Number(value) : undefined;
    };
    return [item.id, { mean: optional(':mean'), standardDeviation: optional(':sd') }];
  }));
  const relative = record.method === 'relative' && simulation.status === 'ready'
    ? analyzeRelativeScenario(record, scenario, modelAssumptions) : [];
  const estimate = estimateRelativeGrade(record);
  const scenarioEstimate = record.method === 'relative' && simulation.status === 'ready' && Object.keys(scenario).length
    ? estimateRelativeGrade(record, scenario, modelAssumptions) : null;
  const baseline = simulateCourseGrade(record);
  const eligible = record.assessments.filter(item =>
    item.weightPercent > 0 && (item.result.status === 'planned' || item.result.status === 'pending'));
  const hasScenario = Object.keys(scenario).length > 0;
  const canSetCutoff = record.method === 'absolute' || record.method === 'passFail';
  const goalValue = condition && canSetCutoff && cutoff.trim() ? cutoff : '';
  const activeTarget = goalValue || target;
  const plan = activeTarget.trim() ? planCourseTarget(record, simulation, Number(activeTarget), scenario) : null;
  const officialTarget = goalValue ? calculateTargetRequirement(baseline, Number(goalValue)) : null;
  const outlook = record.method === 'relative' ? analyzeRelativeOutlook(record, sameCohort) : null;
  const observation = outlook?.assessments.find(item => item.difference !== null);
  const observationMax = record.assessments.find(item => item.id === observation?.id)?.maxScore;
  const cap = outlook?.a ?? outlook?.ab;
  const family = outlook?.a ? 'A계열' : 'A+B계열';
  const hasGradeResult = officialTarget?.status === 'met';
  const noRemaining = baseline.status === 'ready' && baseline.remaining === 0;
  const next = record.method === 'relative'
    ? outlook?.rank ? '등수의 기준 범위와 배정 정책을 확인해 주세요.'
      : observation ? '평균과 표준편차가 같은 평가 집단의 값인지 확인해 주세요.' : '시험 평균을 입력하면 현재 위치를 확인할 수 있어요.'
    : canSetCutoff ? '강의에서 확인한 기준을 목표 학점에 입력해 보세요.' : '성적 수정에서 평가 방식을 확인해 주세요.';

  return <section className="space-y-3 break-words" aria-label="목표 및 시뮬레이션">
    <div className="course-hero">
      <div className="space-y-1">
        <h4 className="font-semibold">나의 예상 학점</h4>
        <p className="text-xl font-semibold">{hasGradeResult ? '조건부 ' + condition + (condition === 'Pass' ? ' 기준 충족' : ' 이상 기준 충족')
          : cap ? '현재 ' + family + ' 상한 ' + (cap.comparison === 'within' ? '이내' : '초과')
          : estimate.status === 'modeled' ? estimateTitle(estimate) : '아직 학점을 예측할 수 없어요.'}</p>
        {hasGradeResult ? <p>입력한 기준을 현재 확보점수로 충족했어요. 출석 등 추가 조건은 포함되지 않아요.</p>
          : cap ? <p>공개 종합 등수와 {outlook?.rank?.policySource === 'assumed' ? '사용자 가정' : '입력한 정책'}을 비교했어요. 최종 학점은 아직 알 수 없어요.</p>
          : estimate.status === 'modeled' ? <p>{estimate.scope === 'included-only' ? '비교 가능한 입력 점수의 부분 전망이에요. ' : ''}
            {observation?.difference != null && observation.name + ' 평균 대비 ' + (observation.difference > 0 ? '+' : '') + format.format(observation.difference) + '점' + (observationMax ? ' (만점 대비 ' + format.format(Math.abs(observation.difference) / observationMax * 100) + '% 차이)' : '') + '. '}
            분포를 가정한 결과이며 실제 석차나 확정 학점과 달라요.</p>
          : observation && observation.difference !== null ? <p>{observation.name} 평균 대비 {observation.difference > 0 ? '+' : ''}{format.format(observation.difference)}점이에요. 최종 등급을 판단할 정보는 부족해요.</p>
          : <p>등급을 판단할 정보가 부족해요.</p>}
        {!hasGradeResult && !cap && estimate.status !== 'modeled' && <p className="course-muted text-sm">{next}</p>}
        {!hasGradeResult && !cap && estimate.status !== 'modeled' && !canSetCutoff && !outlook?.rank &&
          <button type="button" className="dex-button" disabled={busy} onClick={onEdit}>
            {record.method === 'relative' ? observation ? '시험 통계 확인하기' : '시험 평균 입력하기' : '평가 방식 확인하기'}
          </button>}
        {(baseline.status === 'empty' || baseline.status === 'partial') && <p className="course-muted text-sm">평가 비율을 100%까지 입력하면 전체 점수를 계산할 수 있어요.</p>}
        {baseline.status === 'ready' && <p className="text-sm">{noRemaining
          ? '현재 기록된 최종 환산점수 · ' + format.format(baseline.minimum) + '점'
          : '성적 HP · 최대 ' + format.format(baseline.maximum) + '점'}</p>}
      </div>
    </div>
    {estimate.status === 'modeled' && <EstimateDetails result={estimate} enrollment={record.relative?.enrollment} />}
    <div className="course-sheet space-y-2 p-3">
      <label className="block font-semibold">목표 학점
        <select className={control} value={condition} onChange={event => { setCondition(event.target.value); setCutoff(''); setTarget(''); }}>
          <option value="">목표 미선택</option>
          {(record.method === 'passFail' ? ['Pass'] : gradeLabels).map(label => <option key={label}>{label}</option>)}
        </select>
      </label>
      {condition && (canSetCutoff
        ? <label className="block">{condition} 기준 환산점수 (과목 기준 직접 입력)
          <input className={control} type="number" min="0" max="100" step="any" value={cutoff} onChange={event => setCutoff(event.target.value)} />
        </label>
        : <p>현재 정보로는 {condition}에 필요한 점수를 계산할 수 없어요. 등급 배정 기준과 종합 성적 정보가 필요해요.</p>)}
      {condition && canSetCutoff && !goalValue && <p>과목의 기준을 입력하면 필요한 점수를 계산할 수 있어요.</p>}
      {noRemaining && <p>남은 배점이 없어 추가로 받을 점수를 계산할 수 없어요.</p>}
      <details>
        <summary className="cursor-pointer">직접 목표 점수 설정</summary>
        <label className="block">목표 환산점수 (0~100점)
          <input className={control} type="number" min="0" max="100" step="any" value={target}
            onChange={event => { setTarget(event.target.value); setCutoff(''); setCondition(''); }} />
        </label>
      </details>
      {plan && <div aria-live="polite">
        {goalValue && <p className="course-muted text-sm">사용자 입력 기준 · {condition} {goalValue}점</p>}
        {plan.requirement.status === 'met' && <p>{hasScenario ? '입력한 가정에서' : '현재 확보점수로'} 목표 환산점수를 충족해요.</p>}
        {plan.requirement.status === 'impossible' && simulation.status === 'ready' && <p>현재 조건에서 목표 달성이 불가능해요. 최대 {format.format(simulation.maximum)}점이에요.</p>}
        {plan.requirement.status === 'possible' && <p>
          {hasScenario && '다른 평가가 입력한 가정과 같다면, '}
          {plan.raw
            ? plan.raw.name + (plan.raw.pending ? ' 발표 점수가 ' : '에서 받은 점수가 ') + '약 ' + format.format(plan.raw.needed) + ' / ' + format.format(plan.raw.maxScore) + '점이어야 해요.'
            : '미확정 평가에서 반영비율 기준 평균 약 ' + format.format(plan.requirement.requiredRate) + '%가 필요해요.'}
          {!plan.raw && simulation.status === 'ready' && simulation.pendingWeight > 0 && ' 채점 대기 배점도 포함돼요.'}
        </p>}
        {plan.requirement.status === 'invalid-target' && <p role="alert">목표는 0~100점 사이로 입력해 주세요.</p>}
        {plan.requirement.status === 'held' && simulation.status !== 'invalid-scenario' && <p>유효한 평가 비율을 100%까지 입력하면 목표를 계산할 수 있어요.</p>}
      </div>}
    </div>
    {baseline.status === 'ready' && eligible.length > 0 && <details className="course-sheet space-y-2 p-3">
      <summary className="cursor-pointer font-semibold">점수를 바꿔서 비교하기</summary>
      {hasScenario && simulation.status === 'ready' && <p>가정한 최종 환산점수 · {format.format(simulation.minimum)}{simulation.remaining ? ' ~ ' + format.format(simulation.maximum) : ''}점</p>}
      {hasScenario && simulation.status === 'ready' && <p className="course-muted text-sm">실제 확보 {format.format(simulation.secured)}점 · 가상 기여 {format.format(simulation.assumed)}점{simulation.remaining > 0 && ' · 남은 미확정 배점 ' + format.format(simulation.remaining) + '점'}</p>}
      {simulation.status === 'invalid-scenario' && <p role="alert">가상 점수는 0점 이상 만점 이하로 입력해 주세요.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {eligible.map(item => <label key={item.id}>
          {item.name} · {item.result.status === 'pending' ? '채점 대기 · 발표 점수 가정' : '예정 · 받을 점수 가정'} (만점 {item.maxScore}점)
          <input className={control} type="number" min="0" max={item.maxScore} step="any"
            value={Object.hasOwn(scores, item.id) ? scores[item.id] : ''} onChange={event => {
              const value = event.target.value;
              setScores(previous => ({ ...previous, [item.id]: value }));
            }} />
        </label>)}
      </div>
      {scenarioEstimate?.status === 'modeled' && <div className="space-y-1">
        <p>가상 점수 반영 · {estimateTitle(scenarioEstimate)}{scenarioEstimate.scope === 'included-only' && ' · 일부 평가 기준'}</p>
        {condition && !canSetCutoff && <p>{condition}의 필요 점수는 보류해요. 가상 점수를 바꿔 계열 상한과의 관계를 비교할 수 있어요.</p>}
        <EstimateDetails result={scenarioEstimate} enrollment={record.relative?.enrollment} />
      </div>}
      {!!relative.length && <details className="space-y-2">
        <summary className="cursor-pointer">상대평가 가정과 결과</summary>
        <p>가상 점수가 있는 평가만 분석해요. 반 평균과 표준편차는 이 시나리오에서 직접 입력한 값을 사용해요.</p>
        {relative.map(row => <fieldset className="space-y-2 rounded border p-2" key={row.id}>
          <legend>{row.name} · 가상 {format.format(row.score)}점</legend>
          {row.status === 'invalid' ? <p role="alert">가정한 평균·표준편차가 가능한 점수 범위를 벗어났어요.</p> : <>
            {row.difference !== null && <p>가정 평균 대비 {row.difference > 0 ? '+' : ''}{format.format(row.difference)}점{row.z !== null && ' · z ' + format.format(row.z)}</p>}
            {row.status === 'check-statistics' && <p>평균과 표준편차의 조합을 확인해 주세요. z 계산을 보류했어요.</p>}
            {row.status === 'incomplete' && <p>{row.mean === undefined ? '가정 평균을 입력하면 점수 차이를 볼 수 있어요.' : '양의 표준편차가 있어야 표준화 차이를 볼 수 있어요.'}</p>}
          </>}
          <div className="grid gap-2 sm:grid-cols-2">
            {([[':mean', '가정 반 평균'], [':sd', '가정 표준편차']] as const).map(([suffix, label]) => {
              const key = row.id + suffix;
              return <label key={key}>{label}<input className={control} type="number" min={0} step="any"
                value={assumptions[key] ?? ''} onChange={event => {
                  const { value } = event.target;
                  setAssumptions(previous => ({ ...previous, [key]: value }));
                }} /></label>;
            })}
          </div>
        </fieldset>)}
        <p className="course-muted text-sm">평가별 가정 결과입니다. 최종 석차·등급은 보류해요.</p>
      </details>}
      {hasScenario && <button className="dex-button" type="button" onClick={() => { setScores({}); setAssumptions({}); }}>가상 점수 초기화</button>}
    </details>}
  </section>;
}
