'use client';
import { calculateCourseBalance } from '@/lib/dex/course/grade/balance';
import { effectiveRelativePolicy } from '@/lib/dex/course/grade/relative';
import { GRADING_METHODS, SCORE_STATES, confirmedScore } from '@/lib/dex/course/grade-record';
import type { CourseSubject } from '@/lib/dex/course/course';

/** Figma BOKAK v6 (160:751) 과목 카드. 수치는 기록에서만 만들고 없으면 비운다. */
function policyLabel(subject: CourseSubject) {
  const record = subject.gradeRecord;
  if (!record) return { text: '평가 방식 확인 필요', tone: 'unknown' as const };
  if (record.method === 'relative') {
    const caps = effectiveRelativePolicy(record.relative);
    return caps?.aCap !== undefined
      ? { text: `${caps.description ?? '상대평가'} · A≤${caps.aCap}%`, tone: 'relative' as const }
      : { text: '상대평가 · 기준 미선택', tone: 'unknown' as const };
  }
  if (record.method === 'unknown') return { text: '평가 방식 확인 필요', tone: 'unknown' as const };
  return { text: `${GRADING_METHODS[record.method]} · 공식 기준`, tone: 'absolute' as const };
}

export function CourseTcgCard({ subject, onOpen, busy }: {
  subject: CourseSubject; onOpen: () => void; busy?: boolean;
}) {
  const balance = calculateCourseBalance(subject.gradeRecord);
  const totals = balance.status === 'complete' || balance.status === 'partial' ? balance : null;
  const items = subject.gradeRecord?.assessments ?? [];
  const attendance = items.find(item => item.name.includes('출석'));
  const moves = items.filter(item => item !== attendance).slice(0, 3);
  const policy = policyLabel(subject);
  const edition = !subject.gradeRecord ? 'normal'
    : balance.hp === null ? 'normal'
    : subject.review?.shortReview ? 'golden'
    : subject.status === 'completed' ? 'rare' : 'special';
  const secured = totals ? Math.max(0, Math.min(100, totals.secured)) : 0;
  const unconfirmed = totals ? Math.max(0, Math.min(100 - secured, totals.unconfirmed)) : 0;

  return <button type="button" className="bk-card" data-edition={edition} disabled={busy} onClick={onOpen}>
    <span className="bk-card-inner">
      <span className="bk-card-top">
        <span className="bk-card-no">{subject.code ?? '학수번호 없음'}</span>
        <span className="bk-card-hp">{balance.hp === null ? 'HP —' : `HP ${Math.round(balance.hp)}`}</span>
      </span>
      <strong className="bk-card-name">{subject.title}</strong>
      <span className="bk-card-meta">
        {[subject.credits !== undefined ? `${subject.credits}학점` : null, subject.professor].filter(Boolean).join(' · ') || '학점·교수 미입력'}
      </span>

      <span className="bk-card-hpbar" aria-hidden="true">
        <i data-part="secured" style={{ width: `${secured}%` }}/>
        <i data-part="unconfirmed" style={{ width: `${unconfirmed}%` }}/>
      </span>
      <span className="bk-card-balance">
        <b>{totals ? `확보 ${Math.round(totals.secured)}` : '확보 —'}</b>
        <em>{totals ? `미확보 ${Math.round(totals.unconfirmed)}` : '미확보 —'}</em>
      </span>

      <span className="bk-card-policy" data-tone={policy.tone}>{policy.text}</span>

      <span className="bk-card-moves">
        {moves.length ? moves.map(item => {
          const score = confirmedScore(item.result);
          return <span key={item.id} className="bk-card-move">
            <i aria-hidden="true"/>
            <b>{item.name}</b>
            <u>{item.weightPercent}% {score === undefined ? SCORE_STATES[item.result.status] : `확정 ${score}`}</u>
          </span>;
        }) : <span className="bk-card-move bk-card-move--empty">평가항목 없음</span>}
      </span>

      <span className="bk-card-bottom">
        <span>{attendance ? `출석 ${attendance.weightPercent}% · ${SCORE_STATES[attendance.result.status]}` : '출석 평가항목 없음'}</span>
        <span className="bk-card-goal">{balance.hp === null ? '평가 방식부터 확인' : '목표 미설정'}</span>
      </span>
    </span>
  </button>;
}
