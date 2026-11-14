'use client';
import { useEffect, useState } from 'react';
import type { DexDocument } from '@/lib/dex/core/types';
import { MEAL_ACHIEVEMENT_ART } from '@/lib/dex/meal/achievement-art';
import { mealAchievements } from '@/lib/dex/meal/game';
import { mealHighlightSlots } from './highlight-view';
import { MealHighlightCard } from './MealHighlightCard';
import { AchievementStamp } from '@/components/dex/common/AchievementStamp';
import { kstToday } from '@/lib/datetime';

export function MealGamePanel({document}:{document:DexDocument}){
  const [asOf]=useState(()=>kstToday());
  useEffect(()=>{if(window.location.hash==='#meal-achievements')window.document.getElementById('meal-achievements')?.scrollIntoView({block:'start'});},[]);
  const achievements=mealAchievements(document),slots=mealHighlightSlots(document,asOf);
  const achieved=achievements.filter(goal=>goal.status==='achieved').length;
  const tones=['sage','honey','lavender','sage','rose','honey','lavender','honey'] as const;
  return <section className="dex-game-panel dex-campus-notebook" aria-label="나의 학식 업적과 학식 기록">
    <section id="meal-achievements" className="dex-stamp-book" aria-labelledby="meal-stamp-heading">
      <div className="dex-section-heading"><div><span className="dex-eyebrow">한 끼씩 모으는 발견</span><h3 id="meal-stamp-heading">나의 학식 업적</h3></div><span className="dex-tag" aria-label="실제 업적 달성 개수">{achieved} / {achievements.length}개 달성</span></div>
      <p className="dex-small dex-muted">한 끼씩 쌓인 발견의 발자국. 도장을 누르면 조건을 자세히 볼 수 있어요.</p>
      <div className="dex-stamp-grid">{achievements.map((goal,index)=><AchievementStamp key={goal.id} achievement={goal} artwork={MEAL_ACHIEVEMENT_ART[goal.id]} tone={tones[index%tones.length]}/>)}</div>
      <p className="dex-small dex-muted">개인 기록 기준으로 갱신됩니다. 출현 통계가 필요한 도장은 준비 중이며, 랜덤 카드 에디션으로 달성되지 않아요.</p>
    </section>
    <section className="dex-personal-records" aria-labelledby="meal-record-heading"><div className="dex-section-heading"><h3 id="meal-record-heading">나의 학식 기록</h3><span className="dex-small dex-muted">기록에 따라 달라져요</span></div><div className="dex-highlight-grid">{slots.map(slot=><MealHighlightCard key={slot.id} slot={slot}/>)}</div></section>
  </section>;
}
