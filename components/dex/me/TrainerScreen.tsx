'use client';
import { useDexDocument } from '@/components/dex/scaffold/useDexDocument';
import { BackupControls } from '@/components/dex/scaffold/BackupControls';
import { AchievementStamp } from '@/components/dex/common/AchievementStamp';
import { mealAchievements } from '@/lib/dex/meal/game';
import { MEAL_ACHIEVEMENT_ART } from '@/lib/dex/meal/achievement-art';
import { kstToday } from '@/lib/datetime';

const XP_PER_CARD = 20;
const XP_PER_LEVEL = 200;

/** Figma BOKAK v6+ (149:4) 트레이너 화면. 레벨·XP는 수집 기록에서만 계산한다. */
export function TrainerScreen() {
  const { data, loading, error, reload } = useDexDocument();
  const entries = data?.entries ?? [];
  const goals = data ? mealAchievements(data) : [];
  const earned = goals.filter(g => g.status === 'achieved');

  const xp = entries.length * XP_PER_CARD;
  const level = Math.floor(xp / XP_PER_LEVEL) + 1;
  const into = xp % XP_PER_LEVEL;

  const days = new Set(entries.map(e => e.collectedOn));
  const today = kstToday();
  let streak = 0;
  for (let i = 0; ; i++) {
    const d = new Date(today + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    if (!days.has(d.toISOString().slice(0, 10))) break;
    streak++;
  }
  const dexCount = new Set(entries.map(e => e.dexId)).size;

  return <div className="bk-screen">
    <section className="bk-trainer">
      <div className="bk-trainer-avatar" aria-hidden="true">복</div>
      <div className="bk-trainer-body">
        <h2>복학생 트레이너</h2>
        <p className="bk-trainer-sub">Lv.{level} · 이 브라우저의 기록</p>
        <div className="bk-xp" role="img" aria-label={`레벨 ${level}, ${into} / ${XP_PER_LEVEL} XP`}>
          <span style={{ width: `${(into / XP_PER_LEVEL) * 100}%` }}/>
        </div>
        <p className="bk-trainer-xp">{into.toLocaleString()} / {XP_PER_LEVEL} XP</p>
        <p className="bk-trainer-rule">카드 1장 = {XP_PER_CARD} XP</p>
      </div>
    </section>

    <ul className="bk-stats">
      <li><strong>{entries.length}</strong><span>총 수집</span></li>
      <li><strong>{streak}일</strong><span>연속 기록</span></li>
      <li><strong>{dexCount}권</strong><span>쓰는 도감</span></li>
      <li><strong>{earned.length}</strong><span>도장</span></li>
    </ul>

    <section className="bk-section" aria-labelledby="bk-medals">
      <header className="bk-section-head">
        <h2 id="bk-medals">업적 도장</h2>
        <span>{earned.length} / {goals.length} 획득</span>
      </header>
      {loading ? <p role="status">기록을 불러오는 중…</p> : null}
      {error ? <p role="alert">{error} <button type="button" className="bk-link" onClick={() => void reload()}>다시 읽기</button></p> : null}
      {data ? goals.length
        ? <div className="bk-medal-grid">
            {goals.map(goal => goal.status === 'achieved'
              ? <AchievementStamp key={goal.id} achievement={goal} artwork={MEAL_ACHIEVEMENT_ART[goal.id]}/>
              : <div key={goal.id} className="bk-medal-locked"><span aria-hidden="true">?</span><p>{goal.name}</p></div>)}
          </div>
        : <p className="bk-muted">연결된 업적이 아직 없어요.</p> : null}
    </section>

    <section className="bk-section" aria-labelledby="bk-backup">
      <header className="bk-section-head"><h2 id="bk-backup">내 기록 백업</h2></header>
      <p className="bk-muted">기록은 이 브라우저에 저장돼요. 기기를 바꾸기 전에 꼭 내보내 주세요.</p>
      <BackupControls ownerId={data?.profile.ownerId} onChanged={reload}/>
    </section>
  </div>;
}
