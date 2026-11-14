import type { GameNotice } from '@/lib/dex/game/types';
export function GameNoticeList({notices}:{notices:readonly GameNotice[]}){
  if(!notices.length)return null;
  const titles=notices.filter(notice=>notice.kind==='title');
  const achievements=notices.filter(notice=>notice.kind==='achievement');
  return <section className="dex-game-notices" aria-label="이번 기록의 새로운 발견과 업적">
    {titles.map(notice=><p key={notice.id}><strong>✦ {notice.title}</strong><span>{notice.description}</span></p>)}
    {achievements.length?<div className="dex-game-unlocks"><span>새 업적 달성</span>{achievements.map(notice=><span key={notice.id} className="dex-tag" title={notice.description}>✓ {notice.title}</span>)}</div>:null}
  </section>;
}
