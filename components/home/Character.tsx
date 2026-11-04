'use client';

/* ==========================================================================
 *  components/home/Character.tsx — 캐릭터 본체 (SVG 한 장, 외부 에셋 0개)
 * --------------------------------------------------------------------------
 *  옷(몸 색·모자·소품)은 Avatar 가, 표정은 Mood 가 정한다. 둘을 한 컴포넌트가
 *  받긴 하지만 섞이는 자리는 없다 — 꾸미기로 표정을 바꿀 수는 없다.
 *
 *  움직임은 전부 theme.css 의 클래스고, prefers-reduced-motion 에서 꺼진다.
 *  꺼져도 잃는 정보가 없다(표정·하트·문구는 전부 정적 DOM).
 * ========================================================================== */

import type { Avatar, Mood } from '@/components/home/avatar';
import { SKINS } from '@/components/home/avatar';

const MOOD_ALT: Record<Mood, string> = {
  happy: '기분 좋은 표정',
  neutral: '덤덤한 표정',
  worried: '걱정하는 표정',
  panic: '울상',
  hungry: '배고픈 표정',
  munch: '맛있게 먹는 표정',
  blank: '멍한 표정',
};

export function Character({
  avatar,
  mood,
  size = 190,
  /** 값이 바뀌면 먹는 동작을 한 번 재생한다 (key 로 애니메이션 재시작) */
  beat = 0,
}: {
  avatar: Avatar;
  mood: Mood;
  size?: number;
  beat?: number;
}) {
  const s = SKINS[avatar.skin];
  const ink = s.ink;

  const motion =
    mood === 'munch' ? 'e-munch' : mood === 'panic' ? 'e-shake' : 'e-bob';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`${avatar.name} — ${MOOD_ALT[mood]}`}
      style={{ overflow: 'visible' }}
    >
      {/* 바닥 그림자는 같이 뜨지 않게 애니메이션 그룹 밖에 둔다 */}
      <ellipse cx="60" cy="105" rx="29" ry="5.5" fill={ink} opacity="0.12" />

      <g key={`${motion}-${beat}`} className={motion}>
        {/* 발 — 몸 뒤에 둬서 아래로만 삐져나온다 */}
        <ellipse cx="48" cy="99" rx="9.5" ry="5.6" fill={s.shade} />
        <ellipse cx="72" cy="99" rx="9.5" ry="5.6" fill={s.shade} />

        {/* 귀 */}
        <g>
          <ellipse cx="40" cy="36" rx="7.6" ry="12.4" transform="rotate(-22 40 36)" fill={s.shade} />
          <ellipse cx="80" cy="36" rx="7.6" ry="12.4" transform="rotate(22 80 36)" fill={s.shade} />
          <ellipse cx="41" cy="37" rx="3.4" ry="7" transform="rotate(-22 41 37)" fill={s.belly} opacity="0.75" />
          <ellipse cx="79" cy="37" rx="3.4" ry="7" transform="rotate(22 79 37)" fill={s.belly} opacity="0.75" />
        </g>

        {/* 팔 */}
        <ellipse cx="28.5" cy="77" rx="7" ry="10" transform="rotate(16 28.5 77)" fill={s.shade} />
        <ellipse cx="91.5" cy="77" rx="7" ry="10" transform="rotate(-16 91.5 77)" fill={s.shade} />

        {/* 몸 */}
        <ellipse cx="60" cy="66" rx="34" ry="31" fill={s.body} />
        <ellipse cx="60" cy="80" rx="19" ry="13" fill={s.belly} opacity="0.85" />

        {/* 볼 */}
        <ellipse cx="34" cy="70" rx="5.6" ry="3.5" fill={s.blush} opacity={mood === 'munch' ? 0.8 : 0.5} />
        <ellipse cx="86" cy="70" rx="5.6" ry="3.5" fill={s.blush} opacity={mood === 'munch' ? 0.8 : 0.5} />

        <Face mood={mood} ink={ink} />
        <Item item={avatar.item} ink={ink} />
        <Hat hat={avatar.hat} />
        <Extras mood={mood} ink={ink} />
      </g>
    </svg>
  );
}

/* ── 표정 ────────────────────────────────────────────────────────────────── */

function Face({ mood, ink }: { mood: Mood; ink: string }) {
  const stroke = {
    stroke: ink,
    strokeWidth: 2.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };

  // 뜬 눈 + 하이라이트. 하이라이트가 없으면 죽은 눈처럼 보인다.
  const openEyes = (r: number) => (
    <>
      <circle cx="48" cy="61" r={r} fill={ink} />
      <circle cx="72" cy="61" r={r} fill={ink} />
      <circle cx="46.4" cy="59.4" r={r * 0.32} fill="#fff" opacity="0.9" />
      <circle cx="70.4" cy="59.4" r={r * 0.32} fill="#fff" opacity="0.9" />
    </>
  );

  switch (mood) {
    case 'happy':
      return (
        <>
          {openEyes(4.3)}
          <path d="M52 71.5 Q60 79.5 68 71.5" {...stroke} />
        </>
      );

    case 'neutral':
      return (
        <>
          {openEyes(4.1)}
          <path d="M55.5 73 Q60 76.2 64.5 73" {...stroke} strokeWidth={2.6} />
        </>
      );

    case 'worried':
      return (
        <>
          {openEyes(3.8)}
          <path d="M41.5 52.5 L52 56" {...stroke} strokeWidth={2.4} />
          <path d="M78.5 52.5 L68 56" {...stroke} strokeWidth={2.4} />
          <path d="M54 75.5 Q60 70.5 66 75.5" {...stroke} strokeWidth={2.6} />
        </>
      );

    case 'panic':
      return (
        <>
          <path d="M44.6 57.6 L51.4 64.4 M51.4 57.6 L44.6 64.4" {...stroke} />
          <path d="M68.6 57.6 L75.4 64.4 M75.4 57.6 L68.6 64.4" {...stroke} />
          <path d="M40.5 50 L52 55" {...stroke} strokeWidth={2.4} />
          <path d="M79.5 50 L68 55" {...stroke} strokeWidth={2.4} />
          <ellipse cx="60" cy="76" rx="5.4" ry="4.6" fill={ink} />
        </>
      );

    case 'hungry':
      return (
        <>
          {openEyes(4.1)}
          <path d="M43.5 54.5 Q48 51.5 52.5 54.5" {...stroke} strokeWidth={2.2} />
          <path d="M67.5 54.5 Q72 51.5 76.5 54.5" {...stroke} strokeWidth={2.2} />
          <ellipse cx="60" cy="75" rx="4.2" ry="3.4" fill={ink} />
        </>
      );

    case 'munch':
      return (
        <>
          <path d="M43.5 63 Q48 56.5 52.5 63" {...stroke} />
          <path d="M67.5 63 Q72 56.5 76.5 63" {...stroke} />
          <path d="M51 70 Q60 83 69 70 Z" fill={ink} />
          <path d="M56 77.5 Q60 81.5 64 77.5 Z" fill="#e8798a" />
        </>
      );

    case 'blank':
      return (
        <>
          <path d="M44 61 L52 61" {...stroke} />
          <path d="M68 61 L76 61" {...stroke} />
          <path d="M55 73.5 L65 73.5" {...stroke} strokeWidth={2.6} />
        </>
      );
  }
}

/* ── 표정에 딸린 부속 (땀·물음표·꼬르륵·반짝) ─────────────────────────────── */

function Extras({ mood, ink }: { mood: Mood; ink: string }) {
  if (mood === 'worried') {
    return <path d="M95 48 Q99.5 55 95 58.5 Q90.5 55 95 48 Z" fill="#6fb4e8" opacity="0.9" />;
  }

  if (mood === 'panic') {
    return (
      <>
        <path d="M96 44 Q100.5 51 96 54.5 Q91.5 51 96 44 Z" fill="#6fb4e8" opacity="0.9" />
        <path d="M24 50 Q28 56 24 59 Q20 56 24 50 Z" fill="#6fb4e8" opacity="0.75" />
      </>
    );
  }

  if (mood === 'hungry') {
    // 배에서 꼬르륵. 선 두 개면 충분하다
    return (
      <g stroke={ink} strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4">
        <path d="M98 76 Q102 73 106 76" />
        <path d="M99 83 Q103 80 107 83" />
      </g>
    );
  }

  if (mood === 'munch') {
    return (
      <g fill="#f3b63d">
        <path d="M100 52 l1.9 4.1 4.1 1.9 -4.1 1.9 -1.9 4.1 -1.9 -4.1 -4.1 -1.9 4.1 -1.9 Z" />
        <path d="M20 60 l1.3 2.9 2.9 1.3 -2.9 1.3 -1.3 2.9 -1.3 -2.9 -2.9 -1.3 2.9 -1.3 Z" opacity="0.8" />
      </g>
    );
  }

  if (mood === 'blank') {
    return (
      <text
        x="96"
        y="48"
        fontSize="20"
        fontWeight="700"
        fill={ink}
        opacity="0.35"
        textAnchor="middle"
      >
        ?
      </text>
    );
  }

  return null;
}

/* ── 모자 ────────────────────────────────────────────────────────────────── */

function Hat({ hat }: { hat: Avatar['hat'] }) {
  switch (hat) {
    case 'none':
      return null;

    case 'grad':
      return (
        <g>
          <path d="M46 26 h28 a3 3 0 0 1 3 3 v4 a3 3 0 0 1 -3 3 h-28 a3 3 0 0 1 -3 -3 v-4 a3 3 0 0 1 3 -3 Z" fill="#26262b" />
          <path d="M60 11 L88 23 L60 35 L32 23 Z" fill="#1b1b20" />
          <circle cx="60" cy="23" r="2.2" fill="#f3b63d" />
          <path d="M60 23 Q82 26 84 33" stroke="#f3b63d" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="84" cy="36.5" r="3.2" fill="#f3b63d" />
        </g>
      );

    case 'beanie':
      return (
        <g>
          <path d="M36 35 Q60 7 84 35 Z" fill="#3f6fa8" />
          <path d="M33 31 h54 a4 4 0 0 1 0 8 h-54 a4 4 0 0 1 0 -8 Z" fill="#2e5582" />
          <circle cx="60" cy="12" r="5.2" fill="#f2f0ea" />
        </g>
      );

    case 'ribbon':
      return (
        <g>
          <ellipse cx="32" cy="25" rx="7.4" ry="5.2" transform="rotate(-24 32 25)" fill="#e2607f" />
          <ellipse cx="47" cy="21.5" rx="7.4" ry="5.2" transform="rotate(24 47 21.5)" fill="#e2607f" />
          <circle cx="39.5" cy="24.5" r="3.2" fill="#c84a68" />
        </g>
      );

    case 'sprout':
      return (
        <g>
          <path d="M60 36 V17" stroke="#4e8f52" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          <path d="M60 22 C69 17, 73 24, 62.5 27 Z" fill="#6cbf6f" />
          <path d="M60 29 C52 26, 49 31, 58 33 Z" fill="#59a95c" />
        </g>
      );
  }
}

/* ── 소품 ────────────────────────────────────────────────────────────────── */

function Item({ item, ink }: { item: Avatar['item']; ink: string }) {
  switch (item) {
    case 'none':
      return null;

    case 'glasses':
      return (
        <g stroke="#4b4b53" strokeWidth="2.1" fill="none" strokeLinecap="round">
          <circle cx="48" cy="61" r="8.8" fill="#ffffff" fillOpacity="0.16" />
          <circle cx="72" cy="61" r="8.8" fill="#ffffff" fillOpacity="0.16" />
          <path d="M56.8 60.5 Q60 58.8 63.2 60.5" />
          <path d="M39.4 59 L31.5 56.5" />
          <path d="M80.6 59 L88.5 56.5" />
        </g>
      );

    case 'scarf':
      return (
        <g>
          <path d="M36 81 Q60 91.5 84 81 L84 89.5 Q60 100 36 89.5 Z" fill="#c6504e" />
          <path d="M75 88 Q84 93.5 81.5 102 Q75 101.5 71.5 94.5 Z" fill="#aa3f3e" />
          <path d="M39 85 Q60 94.5 81 85" stroke="#aa3f3e" strokeWidth="1.4" fill="none" opacity="0.7" />
        </g>
      );

    case 'card':
      return (
        <g>
          {/* 끈은 입 아래로만 지나간다 — 얼굴을 가로지르면 표정이 안 읽힌다 */}
          <path d="M46 72 Q60 99 74 72" stroke="#5d5d66" strokeWidth="2" fill="none" />
          <rect x="52" y="83.5" width="16" height="11.5" rx="2.4" fill="#f8f6f0" stroke="#c7c4bb" strokeWidth="1" />
          <rect x="54.2" y="85.8" width="5.2" height="7" rx="1.2" fill="#b9d1ee" />
          <g stroke={ink} strokeWidth="1" opacity="0.45" strokeLinecap="round">
            <path d="M61.2 87 h4.6" />
            <path d="M61.2 89.4 h4.6" />
            <path d="M61.2 91.8 h3" />
          </g>
        </g>
      );
  }
}
