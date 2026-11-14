import { AchievementArtwork } from './AchievementArtwork';
import type { Achievement } from '@/lib/dex/game/types';
/** Read-only, domain-neutral stamp. The caller supplies the engine's actual state and icon. */
export function AchievementStamp({achievement,artwork,tone='sage'}:{achievement:Achievement;artwork?:string;tone?:'sage'|'honey'|'rose'|'lavender'}){
  const goal=achievement;
  const state=goal.status==='achieved'?'✓ 달성':goal.status==='preparing'?'준비 중':'미달성';
  return <article className={'dex-stamp is-'+goal.status+' tone-'+tone}>
    <details><summary aria-label={goal.name+' · '+state+' · 자세히 보기'}>
      <span className="dex-stamp-seal" aria-hidden="true"><AchievementArtwork key={artwork} source={artwork} icon={goal.icon}/><small>{goal.status==='achieved'?'발견 완료':goal.status==='preparing'?'준비 중':'아직 빈 칸'}</small></span>
      <span className="dex-stamp-name">{goal.name}</span><span className="dex-stamp-condition">{goal.condition}</span><span className="dex-stamp-state">{state}</span>
    </summary><div className="dex-stamp-info"><p>달성 조건: {goal.condition}</p><p>{goal.status==='preparing'?'관측 통계와 기준이 확정되기 전에는 달성을 판정하지 않아요. 카드 에디션과는 다른 조건이에요.':'현재 개인 기록으로 계산해요. 기록 수정·삭제 시 달성 상태도 바뀔 수 있어요.'}</p><p>최초 달성 시각은 별도로 저장하지 않아요.</p></div></details>
    {goal.progress===null?<p className="dex-stamp-progress-note">판정 대기 · 통계 준비 중</p>:<div className="dex-stamp-progress"><progress value={goal.progress} max={goal.target} aria-label={goal.name+' 진행률'}/><span>{goal.progress}/{goal.target}</span></div>}
  </article>;
}
