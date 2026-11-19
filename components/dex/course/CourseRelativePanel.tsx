import { analyzeRelativeOutlook } from '@/lib/dex/course/grade/outlook';
import type { AssessmentStatistics, CourseRelativeData } from '@/lib/dex/course/grade/relative';
import type { CourseAssessment, CourseGradeRecord } from '@/lib/dex/course/grade-record';

const sources = { unconfirmed: '미확인', 'official-guidance': '공식 안내를 보고 입력', assumed: '사용자 가정' } as const;
const numberFormat = new Intl.NumberFormat('ko', { maximumFractionDigits: 2 });
const input = 'block w-full min-w-0 rounded border p-2';

function field(fields: FormData, key: string) {
  return String(fields.get(key) ?? '').trim();
}

function optionalNumber(fields: FormData, key: string) {
  const value = field(fields, key);
  return value ? Number(value) : undefined;
}

export function readRelative(fields: FormData): CourseRelativeData | undefined {
  const enrollment = optionalNumber(fields, 'enrollment');
  const rank = optionalNumber(fields, 'overallRank');
  const scope = field(fields, 'rankScope');
  const source = (field(fields, 'policySource') || 'unconfirmed') as keyof typeof sources;
  const description = field(fields, 'policyDescription') || undefined;
  const aCap = optionalNumber(fields, 'aCap');
  const abCap = optionalNumber(fields, 'abCap');
  return enrollment !== undefined || rank !== undefined || scope || source !== 'unconfirmed' || description || aCap !== undefined || abCap !== undefined
    ? {
      enrollment,
      overallRank: rank !== undefined || scope ? { rank: rank ?? NaN, scope } : undefined,
      policy: source !== 'unconfirmed' || description || aCap !== undefined || abCap !== undefined ? { source, description, aCap, abCap } : undefined,
    }
    : undefined;
}

export function readStatistics(fields: FormData, id: string): AssessmentStatistics | undefined {
  const mean = optionalNumber(fields, id + ':mean');
  const standardDeviation = optionalNumber(fields, id + ':sd');
  const rank = optionalNumber(fields, id + ':rank');
  const cohortSize = optionalNumber(fields, id + ':cohort');
  if ([mean, standardDeviation, rank, cohortSize].every(value => value === undefined)) return undefined;
  return { mean, standardDeviation, publishedRank: rank === undefined && cohortSize === undefined ? undefined : { rank: rank ?? NaN, cohortSize } };
}

function NumericField({ name, label, value, integer = false }: { name: string; label: string; value?: number; integer?: boolean }) {
  return <label className="block">{label}<input className={input} name={name} type="number" step={integer ? '1' : 'any'} defaultValue={value} /></label>;
}

export function RelativeFields({ relative }: { relative?: CourseRelativeData }) {
  return <details className="space-y-2">
    <summary>상대평가 정책과 공개 종합 등수</summary>
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericField name="enrollment" label="수강인원" value={relative?.enrollment} integer />
      <NumericField name="overallRank" label="공개 종합 등수" value={relative?.overallRank?.rank} integer />
      <label>종합 등수 기준 시점·범위<input className={input} name="rankScope" maxLength={120} defaultValue={relative?.overallRank?.scope} placeholder="예: 중간고사와 과제 반영 후" /></label>
      <label>정책 출처<select className={input} name="policySource" defaultValue={relative?.policy?.source ?? 'unconfirmed'}>
        {Object.entries(sources).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <NumericField name="aCap" label="A계열 상한 (%)" value={relative?.policy?.aCap} />
      <NumericField name="abCap" label="A+B계열 상한 (%)" value={relative?.policy?.abCap} />
      <label>정책 메모<input className={input} name="policyDescription" maxLength={120} defaultValue={relative?.policy?.description} /></label>
    </div>
  </details>;
}

export function StatisticsFields({ id, statistics }: Pick<CourseAssessment, 'id' | 'statistics'>) {
  return <details className="space-y-2">
    <summary>시험 통계와 공개 등수</summary>
    <div className="grid gap-2 sm:grid-cols-2">
      <NumericField name={id + ':mean'} label="시험 평균" value={statistics?.mean} />
      <NumericField name={id + ':sd'} label="시험 표준편차" value={statistics?.standardDeviation} />
      <NumericField name={id + ':rank'} label="공개 시험 등수" value={statistics?.publishedRank?.rank} integer />
      <NumericField name={id + ':cohort'} label="시험 비교 인원" value={statistics?.publishedRank?.cohortSize} integer />
    </div>
  </details>;
}

export function CourseRelativePanel({ record, sameCohort, onSameCohort }: { record: CourseGradeRecord; sameCohort: boolean; onSameCohort: (value: boolean) => void }) {
  const { rank, a, ab, assessments: positions } = analyzeRelativeOutlook(record, sameCohort);
  const policy = record.relative?.policy;
  const assessments = positions.filter(position => position.mean !== null || position.publishedRank ||
    position.standardDeviation !== undefined);
  return <section aria-label="상대평가 분석" className="course-sheet space-y-2 break-words p-3">
    <h4 className="font-semibold">상대평가 분석</h4>
    {record.relative?.enrollment !== undefined && <p>수강인원 {record.relative.enrollment}명</p>}
    {policy && <p>정책 출처 · {sources[policy.source]}{policy.aCap !== undefined && ' · A계열 상한 ' + policy.aCap + '%'}{policy.abCap !== undefined && ' · A+B계열 상한 ' + policy.abCap + '%'}{policy.description && ' · ' + policy.description}</p>}
    {rank && <>
      <p>공개 종합 등수 {rank.rank}등{rank.cohortSize !== undefined && ' / ' + rank.cohortSize + '명'} · {rank.scope}</p>
      {rank.cohortSize !== undefined && policy && policy.source !== 'unconfirmed' &&
        (policy.aCap !== undefined || policy.abCap !== undefined) && <label className="block">
          <input type="checkbox" checked={sameCohort} onChange={event => onSameCohort(event.target.checked)} /> 종합 등수의 비교 집단이 입력한 수강인원과 같아요
        </label>}
      {(a || ab) ? <p>입력한 수강인원과 상한 기준 · {[
        a && 'A계열 상한 ' + (a.comparison === 'within' ? '이내' : '초과') + (a.near ? ' · 경계에서 1등 이내' : ''),
        ab && 'A+B계열 상한 ' + (ab.comparison === 'within' ? '이내' : '초과') + (ab.near ? ' · 경계에서 1등 이내' : ''),
      ].filter(Boolean).join(' · ')}. 순위의 비교 집단과 수강인원이 같을 때의 참고 결과예요. 동점·배정 인원 반올림 규칙은 반영하지 않아요.</p> : <p>수강인원·정책 상한·등수의 비교 집단을 확인하면 상한과 비교할 수 있어요.</p>}
    </>}
    {!rank && !assessments.length && <p>시험 통계나 공개 등수가 없어 상대적 위치 분석을 보류해요. 성적 수정에서 입력할 수 있어요.</p>}
    <ul className="space-y-2">{assessments.map(result => {
      return <li key={result.id} className="border-t pt-2">
        <strong>{result.name} · 반영비율 {result.weight}%</strong>
        <p>내 점수 {result.score ?? '미확정'} · 평균 {result.mean ?? '미입력'} · 표준편차 {result.standardDeviation ?? '미입력'}</p>
        {result.difference !== null ? <p>평균 대비 {result.difference > 0 ? '+' : ''}{numberFormat.format(result.difference)}점
          {' · '}{result.position === 'above' ? '평균보다 높음' : result.position === 'below' ? '평균보다 낮음' : '평균과 같음'}
          {result.z !== null && ' · 표준화 차이 z ' + numberFormat.format(result.z)}
        </p> : <p>확정 점수와 평균이 있으면 점수 차이를 확인할 수 있어요.</p>}
        {result.z === null && <p className="course-muted text-sm">{result.concern ? '평균과 표준편차의 조합을 확인해 주세요. 표준화 차이는 보류했어요.' : '표준화 차이는 확정 점수·평균·0보다 큰 표준편차가 있을 때 표시해요.'}</p>}
        {result.publishedRank && <p>공개 시험 등수 {result.publishedRank.rank}등{result.publishedRank.cohortSize !== undefined && ' / ' + result.publishedRank.cohortSize + '명'}</p>}
      </li>;
    })}</ul>
    <p className="course-muted text-sm">z는 평균과의 차이를 표준편차 단위로 나타낸 값이에요. 시험을 합친 점수 분포와 최종 배정 규칙을 확인할 수 없어 등급 판단을 보류해요. 미확정 평가에 따라 현재 순위는 달라질 수 있어요.</p>
  </section>;
}
