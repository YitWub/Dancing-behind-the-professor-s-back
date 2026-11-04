'use client';

/* ==========================================================================
 *  홈 "오늘의 에리카" — 캐릭터 홈
 * --------------------------------------------------------------------------
 *  세 필러를 카드 세 장으로 나열하던 화면을, 캐릭터 하나를 가운데 두고
 *  필러가 그 캐릭터의 상태로 보이게 바꿨다. 바뀐 건 배치가 아니라 읽는 순서다.
 *
 *    하트   = 출결 장부 (A필러)  — 다 없어지면 F. 비유가 아니라 학사 규정이다
 *    밥     = 오늘 식단 (C필러)  — 먹이는 메뉴는 실제로 올라온 식단뿐이다
 *    꾸미기 = 사용자 취향        — 몸 색·모자·소품. 표정은 못 고른다
 *
 *  ★ 게임처럼 보이는 화면에서 제일 쉬운 유혹이 "빈칸을 그럴듯하게 채우기" 다.
 *    (하트를 모르면 꽉 채우기, 밥을 안 먹었으면 적당히 반쯤 채우기)
 *    여기서는 둘 다 안 한다 — 모르면 '?' 를 띄우고 왜 모르는지 쓴다.
 *    그래서 하트가 비는 것과 하트를 못 세는 것이 다른 그림으로 나온다.
 * ========================================================================== */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { BattleResult, CrawlResult, MealItem, MealTime } from '@/lib/types';
import { loadBattle, loadMeals } from '@/components/data';
import type { QuickInput } from '@/components/mock';
import {
  MOCK_COURSES,
  MOCK_LECTURES,
  MOCK_NEXT_CLASS,
  skipVerdict,
  whatIfQuick,
} from '@/components/mock';
import { cafeteriaLabel, humanDate, mealTimeLabel, toISODate } from '@/components/format';
import { Badge, Card, Icon, SectionTitle, SourceBanner } from '@/components/ui';
import { ScoreLine } from '@/components/meal/Scoreboard';
import { ReliabilityBadge } from '@/components/honey/Reliability';
import type { Avatar } from '@/components/home/avatar';
import { DEFAULT_AVATAR, loadAvatar, saveAvatar } from '@/components/home/avatar';
import type { FedEntry } from '@/components/home/fed';
import { addFed, fedSlots, loadFed, removeFed } from '@/components/home/fed';
import { allHp } from '@/components/home/hp';
import { voiceOf } from '@/components/home/voice';
import { Character } from '@/components/home/Character';
import { HeartsUnknown, HpHearts, HpRoster } from '@/components/home/HpHearts';
import { FeedPanel, FullnessBar } from '@/components/home/FeedPanel';
import { CustomizeSheet } from '@/components/home/CustomizeSheet';

const QUICK_KEY = 'erica.grade.quick.v1';

/** 먹인 직후 표정을 유지하는 시간. 지나면 다시 데이터가 정한 얼굴로 돌아간다. */
const MUNCH_MS = 2600;

function mealTimeNow(): MealTime {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  return 'dinner';
}

/** 학점 화면에 저장해둔 3칸 입력을 읽어온다. 없으면 없는 대로 간다. */
function readQuickInput(): QuickInput | null {
  try {
    const raw = localStorage.getItem(QUICK_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Record<string, string>;
    const n = (s?: string) => {
      const t = (s ?? '').trim();
      if (t === '') return null;
      const v = Number(t);
      return Number.isFinite(v) ? v : null;
    };
    return {
      myScore: n(d.myScore), mean: n(d.mean), stdev: n(d.stdev),
      enrolled: n(d.enrolled), maxScore: n(d.maxScore) ?? 100,
    };
  } catch {
    return null;
  }
}

/**
 * 하이드레이션이 끝났는가. 서버 렌더와 1회차 렌더는 false 다.
 *
 * 보는 사람의 시계(오늘 날짜·지금 끼니)와 브라우저 저장소(꾸미기·먹인 기록)는
 * 서버에서 읽을 수 없는 값이라 "서버 기본값 → 클라이언트 실제값" 두 단계가 꼭 필요하다.
 * 그 전환을 effect + setState 로 하면 렌더가 한 번 더 도는 데다 린트에도 걸리므로
 * (react-hooks/set-state-in-effect) 전환 자체를 외부 스토어로 읽는다.
 */
const subscribeNever = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

type Panel = 'none' | 'feed' | 'dress';

interface Boot {
  date: string;
  hour: number;
  mealTime: MealTime;
  quick: QuickInput | null;
  avatar: Avatar;
  fed: FedEntry[];
}

export function HomeScreen({ initialDate }: { initialDate: string }) {
  const hydrated = useHydrated();

  /** 브라우저에서만 알 수 있는 시작값. 하이드레이션 직후 한 번 읽는다. */
  const boot: Boot = useMemo(() => {
    if (!hydrated) {
      return {
        date: initialDate, hour: 12, mealTime: 'lunch',
        quick: null, avatar: DEFAULT_AVATAR, fed: [],
      };
    }
    const now = new Date();
    const today = toISODate(now);
    return {
      date: today,
      hour: now.getHours(),
      mealTime: mealTimeNow(),
      quick: readQuickInput(),
      avatar: loadAvatar(),
      fed: loadFed(today),
    };
  }, [hydrated, initialDate]);

  // 사용자가 건드린 값만 state 로 잡는다. null = "아직 안 건드림, 시작값 그대로".
  const [mealTimePick, setMealTimePick] = useState<MealTime | null>(null);
  const [avatarEdit, setAvatarEdit] = useState<Avatar | null>(null);
  const [fedEdit, setFedEdit] = useState<FedEntry[] | null>(null);

  const date = boot.date;
  const hour = boot.hour;
  const mealTime = mealTimePick ?? boot.mealTime;
  const avatar = avatarEdit ?? boot.avatar;
  const fed = fedEdit ?? boot.fed;
  const quick = boot.quick;

  const [crawl, setCrawl] = useState<CrawlResult | null>(null);
  const [mealSource, setMealSource] = useState<{ source: 'api' | 'mock'; note?: string }>({ source: 'api' });
  const [battle, setBattle] = useState<BattleResult | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  /** 방금 먹인 메뉴. 말풍선·표정이 한 박자만 이걸 본다 */
  const [justFed, setJustFed] = useState<string | null>(null);
  /** 먹는 동작 재생용 — 값이 바뀌면 애니메이션이 처음부터 다시 돈다 */
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([loadMeals(date), loadBattle(date, mealTime)]).then(([m, b]) => {
      if (!alive) return;
      setCrawl(m.data);
      setMealSource({ source: m.source, note: m.note });
      setBattle(b.data);
    });
    return () => {
      alive = false;
    };
  }, [date, mealTime]);

  useEffect(() => {
    if (justFed == null) return;
    const t = setTimeout(() => setJustFed(null), MUNCH_MS);
    return () => clearTimeout(t);
  }, [justFed]);

  /* ── 상태 ──────────────────────────────────────────────────────────────── */

  // 과목별로 F 가 떨어지므로 평균을 내지 않는다. 캐릭터 체력은 제일 아슬아슬한 과목.
  const roster = allHp(MOCK_COURSES);
  const hp = roster[0] ?? null;
  const skip = skipVerdict(quick ? whatIfQuick(quick)[0] : undefined);
  const fedCount = fedSlots(fed).length;
  const voice = voiceOf({ hp, fedCount, justFed, hour, skip });

  const todayItems = crawl?.items ?? [];
  const pick = MOCK_LECTURES.filter((l) => l.reliability.band !== 'low')[0];

  /* ── 동작 ──────────────────────────────────────────────────────────────── */

  const changeAvatar = (next: Avatar) => {
    setAvatarEdit(next);
    saveAvatar(next);
  };

  const onFeed = (item: MealItem) => {
    const label = item.name ?? item.menu[0] ?? cafeteriaLabel(item.cafeteria);
    setFedEdit(
      addFed(date, {
        mealItemId: item.id,
        mealTime: item.mealTime,
        label,
        at: new Date().toISOString(),
      }),
    );
    setJustFed(label);
    setBeat((b) => b + 1);
  };

  const onUndo = (mealItemId: string) => {
    setFedEdit(removeFed(date, mealItemId));
    setJustFed(null);
  };

  const toggle = (p: Exclude<Panel, 'none'>) => setPanel((cur) => (cur === p ? 'none' : p));

  return (
    <div className="flex flex-col gap-3">
      {/* ① 캐릭터 ─ 하트 / 스테이지 / 밥 ─────────────────────────────────── */}
      <Card className="overflow-hidden">
        {/* 하트는 캐릭터보다 위에 있어야 한다. 먼저 읽히는 쪽이 더 중요한 수다 */}
        <div className="px-4 pb-3 pt-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[12px] font-semibold tracking-tight text-[var(--e-muted)]">
              출석 하트 — 다 없어지면 F
            </h2>
            <Link href="/grade" className="shrink-0 text-[11.5px] font-medium text-[var(--e-accent)]">
              출결 고치기
            </Link>
          </div>
          {hp ? <HpHearts hp={hp} /> : <HeartsUnknown />}
        </div>

        {/* 무대 */}
        <div
          className="relative border-y border-[var(--e-border)] px-4 pb-1 pt-4"
          style={{ background: 'linear-gradient(180deg, var(--e-stage-top), var(--e-stage-bottom))' }}
        >
          <Bubble name={avatar.name} line={voice.line} />
          <div className="mt-1 flex justify-center">
            <Character avatar={avatar} mood={voice.mood} beat={beat} size={196} />
          </div>
        </div>

        {/* 밥 게이지 + 두 버튼 */}
        <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-[var(--e-muted)]">
              오늘 먹인 끼니 — 누른 기록만 셉니다
            </p>
            <FullnessBar fed={fed} />
          </div>

          <div className="flex gap-2">
            <SheetButton
              on={panel === 'feed'}
              onClick={() => toggle('feed')}
              accent="var(--e-changbo)"
              icon={<BowlIcon />}
              label="밥 먹이기"
            />
            <SheetButton
              on={panel === 'dress'}
              onClick={() => toggle('dress')}
              accent="var(--e-accent)"
              icon={<BrushIcon />}
              label="꾸미기"
            />
          </div>

          {panel === 'feed' ? (
            <div className="flex flex-col gap-3 border-t border-[var(--e-border)] pt-3">
              <SourceBanner source={mealSource.source} note={mealSource.note} />
              <FeedPanel
                mealTime={mealTime}
                onMealTime={setMealTimePick}
                items={todayItems}
                fed={fed}
                onFeed={onFeed}
                onUndo={onUndo}
              />
            </div>
          ) : null}

          {panel === 'dress' ? (
            <div className="border-t border-[var(--e-border)] pt-3">
              <CustomizeSheet avatar={avatar} onChange={changeAvatar} />
            </div>
          ) : null}
        </div>
      </Card>

      {/* ② 째도 되나 — 하트가 어디서 왔는지 보여주는 카드 ─────────────────── */}
      <Card className="p-4">
        <SectionTitle
          title="다음 수업, 째도 되나"
          right={<Link href="/grade" className="text-[12px] font-medium text-[var(--e-accent)]">자세히</Link>}
        />
        <p className="text-[12.5px] text-[var(--e-muted)]">
          {MOCK_NEXT_CLASS.startsAt} · {MOCK_NEXT_CLASS.courseName} · {MOCK_NEXT_CLASS.room}
        </p>

        <div
          className="mt-3 flex items-start gap-2 rounded-xl px-3 py-3"
          style={{
            background:
              skip.tone === 'careful'
                ? 'color-mix(in srgb, var(--e-warn) 15%, transparent)'
                : skip.tone === 'ok'
                  ? 'color-mix(in srgb, var(--e-good) 11%, transparent)'
                  : 'var(--e-surface-2)',
          }}
        >
          <Icon
            name={skip.tone === 'careful' ? 'warn' : skip.tone === 'ok' ? 'good' : 'blur'}
            className="mt-[2px] h-4 w-4 shrink-0"
          />
          <p className="text-[13.5px] font-semibold leading-snug text-[var(--e-ink)]">{skip.line}</p>
        </div>

        {skip.tone === 'unknown' ? (
          <Link
            href="/grade"
            className="mt-3 flex items-center justify-center gap-1 rounded-full px-4 py-2.5 text-[13px] font-semibold text-white"
            style={{ background: 'var(--e-accent)' }}
          >
            10초 진단하러 가기
            <Icon name="chevron" className="h-3.5 w-3.5" />
          </Link>
        ) : null}

        {roster.length > 0 ? (
          <div className="mt-3 border-t border-[var(--e-border)] pt-3">
            <p className="mb-2 text-[11.5px] font-medium text-[var(--e-muted)]">
              과목별 하트 — F 는 과목마다 따로 떨어지므로 평균을 내지 않습니다
            </p>
            <HpRoster list={roster} />
          </div>
        ) : null}
      </Card>

      {/* ③ 창보 vs 학식 ──────────────────────────────────────────────────── */}
      <Card className="p-4">
        <SectionTitle
          title={`오늘 ${mealTimeLabel(mealTime)} 대결`}
          hint={humanDate(date)}
          right={<Link href="/meal" className="text-[12px] font-medium text-[var(--e-accent)]">전체</Link>}
        />

        {battle ? (
          <>
            <ScoreLine battle={battle} />
            <p className="mt-2 text-[11.5px] leading-snug text-[var(--e-muted)]">{battle.headline}</p>
          </>
        ) : (
          <p className="text-[13px] text-[var(--e-muted)]">대결 점수를 아직 못 가져왔습니다.</p>
        )}
      </Card>

      {/* ④ 꿀강 ─────────────────────────────────────────────────────────── */}
      <Card className="p-4">
        <SectionTitle
          title="꿀강 찾기"
          hint="별점 평균 말고 신뢰도부터 봅니다"
          right={<Link href="/honey" className="text-[12px] font-medium text-[var(--e-accent)]">전체</Link>}
        />

        {pick ? (
          <Link href={`/honey/${pick.id}`} className="block rounded-xl bg-[var(--e-surface-2)] px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold text-[var(--e-ink)]">{pick.name}</p>
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--e-muted)]">
                  {pick.professor} · {pick.type}
                </p>
              </div>
              {pick.honeyScore != null ? (
                <span className="shrink-0 text-[20px] font-bold leading-none tabular-nums" style={{ color: 'var(--e-ord-4)' }}>
                  {Math.round(pick.honeyScore)}
                </span>
              ) : null}
            </div>
            <div className="mt-2">
              <ReliabilityBadge lecture={pick} />
            </div>
          </Link>
        ) : null}

        <div className="mt-3">
          <Badge tone="neutral" icon="info">표본이 모자란 강의는 지수를 가려서 위로 올리지 않습니다</Badge>
        </div>
      </Card>
    </div>
  );
}

/* ── 조각 ────────────────────────────────────────────────────────────────── */

function Bubble({ name, line }: { name: string; line: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[304px]">
      <div className="rounded-2xl border border-[var(--e-border)] bg-[var(--e-surface)] px-3.5 py-2.5 shadow-sm">
        <p className="text-[10.5px] font-semibold tracking-wide text-[var(--e-muted)]">{name}</p>
        <p className="mt-0.5 text-[13px] font-semibold leading-snug text-[var(--e-ink)]">{line}</p>
      </div>
      <span
        aria-hidden
        className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rotate-45 border-b border-r border-[var(--e-border)] bg-[var(--e-surface)]"
      />
    </div>
  );
}

function SheetButton({
  on, onClick, accent, icon, label,
}: {
  on: boolean;
  onClick: () => void;
  accent: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={on}
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-full border px-4 py-2.5 text-[13px] font-semibold transition-colors"
      style={{
        borderColor: on ? accent : 'var(--e-border-strong)',
        background: on ? accent : 'var(--e-surface)',
        color: on ? '#fff' : 'var(--e-ink)',
      }}
    >
      {icon}
      {label}
      {/* 펼침 상태를 화살표로도 알린다 — 색만으로 토글을 나르지 않는다 */}
      <span
        className="inline-flex transition-transform"
        style={{ transform: on ? 'rotate(90deg)' : undefined }}
      >
        <Icon name="chevron" className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function BowlIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 11.5h14a6.2 6.2 0 0 1-6.2 5H9.2A6.2 6.2 0 0 1 3 11.5Z" />
      <path d="M7 8.2c0-1.2 1.2-1.5 1.2-2.6" />
      <path d="M10.4 8.2c0-1.2 1.2-1.5 1.2-2.6" />
    </svg>
  );
}

function BrushIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13.8 3.4a1.9 1.9 0 0 1 2.8 2.6l-6.2 7-3.4 1 1-3.4 5.8-7.2Z" />
      <path d="M5.5 14.2c-1.4.6-2 1.9-2.2 3.3 1.5-.2 2.8-.8 3.4-2.2" />
    </svg>
  );
}
