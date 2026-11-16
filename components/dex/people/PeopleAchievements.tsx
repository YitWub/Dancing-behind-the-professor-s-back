import type { DexDocument } from '@/lib/dex/core/types';
import { peopleAchievements } from '@/lib/dex/people/game';
import { AchievementStamp } from '@/components/dex/common/AchievementStamp';
export function PeopleAchievements({data}:{data:DexDocument}){
 const goals=peopleAchievements(data),count=goals.filter(g=>g.status==='achieved').length;
 return <section aria-labelledby="people-achievements-title"><div className="people-heading"><h2 id="people-achievements-title">인연도감 업적</h2><span>달성 {count}/{goals.length}</span></div><p className="people-privacy">현재 남아 있는 기록으로 계산해요. 인연·추억·실을 삭제하면 달성 상태도 바뀔 수 있어요.</p><div className="dex-stamp-grid">{goals.map(goal=><AchievementStamp key={goal.id} achievement={goal}/>)}</div></section>;
}
