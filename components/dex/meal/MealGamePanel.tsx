'use client';
import { useState } from 'react';
import type { DexDocument } from '@/lib/dex/core/types';
import Link from 'next/link';
import { mealAchievements } from '@/lib/dex/meal/game';
import { mealHighlightSlots } from './highlight-view';
import { MealHighlightCard } from './MealHighlightCard';
import { kstToday } from '@/lib/datetime';

export function MealGamePanel({document}:{document:DexDocument}){
  const [asOf]=useState(()=>kstToday());
  const achievements=mealAchievements(document),slots=mealHighlightSlots(document,asOf);
  const unlocked=achievements.filter(goal=>goal.status==='achieved');
  const achieved=unlocked.length;
  return <section className="dex-game-panel" aria-label="나의 학식 업적과 대표 메뉴">
    <div className="dex-section-heading"><div><span className="dex-eyebrow">MY CAMPUS QUEST</span><h3>한 끼의 발견이, 나의 업적으로.</h3></div><span className="dex-tag">달성 {achieved}개</span></div>
    <p className="dex-muted">직접 남긴 개인 기록으로 계산해요. 공식 식사 인증이나 메뉴의 맛 순위는 아니에요.</p>
    <div className="dex-highlight-grid">{slots.map(slot=><MealHighlightCard key={slot.id} slot={slot}/>)}</div>
    <div className="dex-achievement-showcase" aria-label="달성한 업적 배지"><span className="dex-eyebrow">MY BADGES</span>{unlocked.length?<><div>{unlocked.slice(0,3).map(goal=><span key={goal.id} className="dex-unlocked-badge"><span aria-hidden="true">{goal.icon}</span>{goal.name}</span>)}{unlocked.length>3?<span className="dex-tag">외 {unlocked.length-3}개</span>:null}</div><p>내 기록으로 모은 배지 {achieved}개</p></>:<p>아직 빈 배지판 · 첫 메뉴부터 시작해 보세요.</p>}</div>
    <details className="dex-achievement-details"><summary>나의 업적 보기 <span>{achieved}개 달성 · 기록에 따라 갱신</span></summary>
      <div className="dex-achievement-grid">{achievements.map(goal=><article key={goal.id} className={`dex-achievement is-${goal.status}`}>
        <span className="dex-achievement-icon" aria-hidden="true">{goal.icon}</span><div><h4>{goal.name}</h4><p>{goal.condition}</p>
          {goal.progress===null?<p className="dex-achievement-state">집계 준비 중 · 희귀도 통계 필요</p>:<><div className="dex-achievement-progress"><progress value={goal.progress} max={goal.target} aria-label={`${goal.name} 진행률`}/><span>{goal.progress}/{goal.target}</span></div><p className="dex-achievement-state">{goal.status==='achieved'?'✓ 현재 기록 기준 달성':'미달성 · 잠금'}</p></>}
        </div>
      </article>)}</div>
      <p className="dex-small dex-muted">경험 날짜를 수정하거나 기록을 삭제하면 진행률·달성 상태도 다시 계산돼요. 과거 최초 달성 시각은 별도로 저장하지 않아요.</p>
    </details>
    {process.env.NODE_ENV==='development'?<Link href="/dex/dev/rarity" className="dex-preview-link">개발 전용 · 희귀도 카드 공개 미리보기 ↗</Link>:null}
  </section>;
}
