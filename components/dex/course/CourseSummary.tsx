'use client';
import { useState } from 'react';
import { calculateCourseBalance } from '@/lib/dex/course/grade/balance';
import { simulateCourseGrade } from '@/lib/dex/course/grade/simulation';
import { planCourseTarget } from '@/lib/dex/course/grade/goal';
import { ERICA_POLICY_SOURCE } from '@/lib/dex/course/grade/presets';
import { effectiveRelativePolicy } from '@/lib/dex/course/grade/relative';
import { GRADING_METHODS, SCORE_STATES, confirmedScore } from '@/lib/dex/course/grade-record';
import { GRADE_CUTOFFS } from '@/lib/grade/grading-policy';
import type { CourseSubject } from '@/lib/dex/course/course';

const n1 = (v: number) => v.toFixed(1);
const ABSOLUTE_GOALS = [['A+', GRADE_CUTOFFS['A+']], ['A0', GRADE_CUTOFFS.A0], ['B+', GRADE_CUTOFFS['B+']], ['B0', GRADE_CUTOFFS.B0]] as const;
const POINT_GOALS = [['95점', 95], ['90점', 90], ['85점', 85], ['80점', 80]] as const;

/** Figma BOKAK v7 (131:8) 요약 탭. 계산 가능한 값만 보여주고 없는 값은 비워 둔다. */
export function CourseSummary({ subject }: { subject: CourseSubject }) {
  const record = subject.gradeRecord;
  const method = record?.method ?? 'unknown';
  const balance = calculateCourseBalance(record);
  const simulation = simulateCourseGrade(record);
  const caps = record ? effectiveRelativePolicy(record.relative) : undefined;
  const absolute = method === 'absolute';
  const goals = absolute ? ABSOLUTE_GOALS : POINT_GOALS;
  const [target, setTarget] = useState<number>(goals[1][1]);
  const plan = record && simulation.status === 'ready' ? planCourseTarget(record, simulation, target) : null;
  const totals = balance.status === 'complete' || balance.status === 'partial' ? balance : null;
  const lost = totals ? totals.lost : null;

  return <div className="bk-summary">
    <section className="bk-block">
      <h3>① 현재 성적 현황</h3>
      {balance.hp !== null ? <>
        <p className="bk-hp"><strong>{n1(balance.hp)}</strong><span>/ 100 현재 최고 가능</span></p>
        <div className="bk-hp-bar" role="img" aria-label={`확보 ${n1(totals!.secured)}점, 미확보 ${n1(totals!.unconfirmed)}점, 상실 ${n1(lost!)}점`}>
          <i data-part="secured" style={{ width: `${totals!.secured}%` }}/>
          <i data-part="unconfirmed" style={{ width: `${totals!.unconfirmed}%` }}/>
          <i data-part="lost" style={{ width: `${lost}%` }}/>
        </div>
        <ul className="bk-legend">
          <li data-part="secured">확보 {n1(totals!.secured)}</li>
          <li data-part="unconfirmed">미확보 {n1(totals!.unconfirmed)}</li>
          <li data-part="lost">상실 {n1(lost!)}</li>
        </ul>
      </> : <p className="bk-muted">{balance.status === 'not-started' ? '평가항목을 기록하면 점수가 계산돼요.'
        : balance.status === 'partial' ? `반영비율 합계가 100%가 아니에요. 남은 ${n1(balance.unallocatedWeight)}%를 설정하면 HP가 나와요.`
        : balance.status === 'empty' ? '평가항목이 아직 없어요.' : '평가 기록을 확인해 주세요.'}</p>}
    </section>

    <section className="bk-block">
      <h3>② 현재 예상 성적</h3>
      <span className="bk-badge">{GRADING_METHODS[method]}</span>
      {simulation.status === 'ready'
        ? <p className="bk-range"><strong>{n1(simulation.minimum)} ~ {n1(simulation.maximum)}점</strong><span>확정 기록만으로 가능한 최종점수 범위</span></p>
        : <p className="bk-muted">확정 점수와 반영비율이 모두 있어야 범위를 계산할 수 있어요.</p>}
      {method === 'relative' ? <p className="bk-note">
        {caps && caps.aCap !== undefined && caps.abCap !== undefined
          ? `${caps.description ?? '상대평가'} · A 최대 ${caps.aCap}% · A+B 최대 ${caps.abCap}%`
          : '상대평가 기준이 아직 선택되지 않았어요.'}
        <br/>배분 상한이지 내 등급 확률이 아니에요. 등급은 상대적 위치가 있어야 정해져요.
      </p> : null}
      {method === 'unknown' ? <p className="bk-note">평가 방식이 확인되지 않았어요. 점수 범위와 목표 총점 계산은 그대로 쓸 수 있어요.</p> : null}
      {method === 'passFail' ? <p className="bk-note">합격점은 강좌마다 달라요. 임의의 합격점을 적용하지 않아요.</p> : null}
    </section>

    <section className="bk-block bk-block--goal">
      <h3>③ 나의 목표 학점</h3>
      <div className="bk-goal-chips" role="group" aria-label="목표 선택">
        {goals.map(([label, value]) => <button key={label} type="button" aria-pressed={target === value}
          onClick={() => setTarget(value)}>{label}</button>)}
      </div>
      {!absolute ? <p className="bk-note">총점 기준으로 계산해요. {method === 'relative' ? '이 점수가 등급을 보장하지는 않아요.' : ''}</p> : <p className="bk-note">학교 최종점수 기준 · <a href={ERICA_POLICY_SOURCE} target="_blank" rel="noreferrer">공식 안내</a></p>}
      {plan ? (() => {
        const r = plan.requirement;
        if (r.status === 'met') return <p className="bk-goal-main">이미 {target}점에 도달했어요</p>;
        if (r.status === 'impossible') return <>
          <p className="bk-goal-main" data-bad="">남은 배점으로는 닿지 않아요</p>
          <p className="bk-note">최고 가능 {n1(simulation.status === 'ready' ? simulation.maximum : 0)}점 · 목표 {target}점</p>
        </>;
        if (r.status === 'possible') return <>
          <p className="bk-goal-main">남은 평가에서 평균 <strong>{Math.ceil(r.requiredRate)}%</strong></p>
          {plan.raw
            ? <p className="bk-note">{plan.raw.name}에서 약 {Math.ceil(plan.raw.needed)} / {plan.raw.maxScore}점{plan.raw.pending ? ' (채점 대기)' : ''}</p>
            : <p className="bk-note">남은 평가가 여러 개라 배분은 직접 정해요. 한 개만 남으면 필요 점수를 바로 계산해요.</p>}
        </>;
        return <p className="bk-muted">평가항목과 반영비율을 먼저 확인해 주세요.</p>;
      })() : <p className="bk-muted">평가 기록이 있어야 목표를 계산할 수 있어요.</p>}
    </section>

    <details className="bk-block bk-details">
      <summary>④ 상세 분석 · 평가항목별</summary>
      {totals ? <ul className="bk-item-list">
        {totals.items.map(item => <li key={item.id}>
          <b>{item.name}</b>
          <span>{item.weight}%</span>
          <em>{SCORE_STATES[item.status]}</em>
          <u>{item.secured === null ? `미확보 ${n1(item.unconfirmed)}` : `확보 ${n1(item.secured)} · 상실 ${n1(item.lost)}`}</u>
        </li>)}
      </ul> : <p className="bk-muted">표시할 평가항목이 없어요.</p>}
      {record ? <p className="bk-note">확정 점수 {record.assessments.filter(a => confirmedScore(a.result) !== undefined).length}개 · 전체 {record.assessments.length}개</p> : null}
    </details>
  </div>;
}
