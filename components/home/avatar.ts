/* ==========================================================================
 *  components/home/avatar.ts — 캐릭터 "에리" 의 옷장과 기분
 * --------------------------------------------------------------------------
 *  꾸미기(이름·몸 색·모자·소품)는 사용자가 고르는 값이고 브라우저에만 남는다.
 *  표정은 고를 수 없다 — 표정은 데이터가 정한다(하트 상태·오늘 먹은 끼니).
 *  "기분 좋아 보이게" 꾸밀 수 있으면 화면이 거짓말을 할 수 있기 때문이다.
 * ========================================================================== */

export type SkinId = 'cream' | 'mint' | 'peach' | 'sky' | 'lilac' | 'coal';
export type HatId = 'none' | 'grad' | 'beanie' | 'ribbon' | 'sprout';
export type ItemId = 'none' | 'glasses' | 'scarf' | 'card';

export interface Avatar {
  name: string;
  skin: SkinId;
  hat: HatId;
  item: ItemId;
}

export const DEFAULT_AVATAR: Avatar = {
  name: '에리',
  skin: 'cream',
  hat: 'none',
  item: 'none',
};

export const NAME_MAX = 8;

/**
 * 옷 색은 의미를 나르지 않는 장식이라 theme.css 의 검증된 데이터 색 슬롯을
 * 쓰지 않는다(섞이면 "초록 = 안전" 같은 오해가 생긴다).
 * 대신 어느 테마에서도 같은 캐릭터로 보이도록 고정값으로 둔다.
 * `ink` 는 눈·입 색 — 몸이 어두운 'coal' 만 밝은 잉크를 쓴다.
 */
export const SKINS: Record<
  SkinId,
  { label: string; body: string; shade: string; belly: string; blush: string; ink: string }
> = {
  cream: { label: '크림',   body: '#f6d9a8', shade: '#e4bd81', belly: '#fdf1dc', blush: '#f0a08f', ink: '#2b2622' },
  mint:  { label: '민트',   body: '#a8ddcb', shade: '#7fc3ad', belly: '#e2f6ef', blush: '#eb9d94', ink: '#1f2d29' },
  peach: { label: '복숭아', body: '#f9bfb4', shade: '#e49e91', belly: '#fde7e1', blush: '#e2756a', ink: '#30231f' },
  sky:   { label: '하늘',   body: '#b3cdf2', shade: '#8bb0e2', belly: '#e5eefb', blush: '#ec9b94', ink: '#1f2733' },
  lilac: { label: '라일락', body: '#cdc0ea', shade: '#aa9bd3', belly: '#eee8fa', blush: '#e596a8', ink: '#29233a' },
  coal:  { label: '숯',     body: '#4a4a4f', shade: '#36363a', belly: '#6a6a71', blush: '#c56d72', ink: '#f7f5ef' },
};

export const HATS: { id: HatId; label: string }[] = [
  { id: 'none',   label: '없음' },
  { id: 'grad',   label: '학사모' },
  { id: 'beanie', label: '비니' },
  { id: 'ribbon', label: '리본' },
  { id: 'sprout', label: '새싹' },
];

export const ITEMS: { id: ItemId; label: string }[] = [
  { id: 'none',    label: '없음' },
  { id: 'glasses', label: '안경' },
  { id: 'scarf',   label: '목도리' },
  { id: 'card',    label: '학생증' },
];

/* ── 표정 ────────────────────────────────────────────────────────────────── */

/**
 * 고를 수 없는 값. 전부 데이터에서 나온다.
 *   munch   방금 밥을 먹였다
 *   panic   하트 0 개 — 출석 F 구간
 *   worried 하트 1 개 이하
 *   hungry  오늘 먹었다고 표시한 끼니가 아직 없다
 *   blank   출결 장부가 없어 하트를 못 센다
 */
export type Mood = 'happy' | 'neutral' | 'worried' | 'panic' | 'hungry' | 'munch' | 'blank';

/* ── 저장 ────────────────────────────────────────────────────────────────── */

const KEY = 'erica.home.avatar.v1';

function sanitize(raw: unknown): Avatar {
  const d = (raw ?? {}) as Partial<Record<keyof Avatar, unknown>>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fb;

  const name = typeof d.name === 'string' ? d.name.trim().slice(0, NAME_MAX) : '';

  return {
    name: name === '' ? DEFAULT_AVATAR.name : name,
    skin: pick(d.skin, Object.keys(SKINS) as SkinId[], DEFAULT_AVATAR.skin),
    hat: pick(d.hat, HATS.map((h) => h.id), DEFAULT_AVATAR.hat),
    item: pick(d.item, ITEMS.map((i) => i.id), DEFAULT_AVATAR.item),
  };
}

/** 저장소를 못 읽어도 기본 캐릭터로 그냥 시작한다 (시크릿 모드 등). */
export function loadAvatar(): Avatar {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitize(JSON.parse(raw)) : DEFAULT_AVATAR;
  } catch {
    return DEFAULT_AVATAR;
  }
}

export function saveAvatar(a: Avatar): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* 저장 실패는 꾸미기 한 판이 안 남는 것뿐이라 화면을 멈추지 않는다 */
  }
}
