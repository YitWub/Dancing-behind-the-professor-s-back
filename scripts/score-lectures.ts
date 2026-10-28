/**
 * scripts/score-lectures.ts — 꿀강 오프라인 파이프라인 (빌드 타임 1회)
 *
 *   node scripts/score-lectures.ts            # 키 있으면 LLM, 없으면 휴리스틱
 *   node scripts/score-lectures.ts --heuristic # 강제로 휴리스틱만
 *   node scripts/score-lectures.ts --verify    # 휴리스틱 추출값 vs 시드 정답 상관 검증
 *
 * ★런타임에 API 키를 요구하지 않는다.
 *   여기서 data/lectures.json 을 구워 두면 앱은 그 JSON 만 읽는다.
 *   키가 없어도 `npm run build` 와 데모가 그대로 돌아간다.
 *
 * LLM 호출 경로 (claude-api 스킬 기준)
 *   1) @anthropic-ai/sdk 가 설치돼 있으면 공식 SDK 사용
 *   2) 없으면 POST https://api.anthropic.com/v1/messages 로 직접 호출
 *   package.json 에 의존성을 추가할 수 없어서(팀 규약) 두 경로를 모두 둔다.
 *   모델은 팀 지정에 따라 claude-sonnet-5 (ANTHROPIC_MODEL 로 변경 가능).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Lecture, LectureReview } from '../lib/types.ts';
import {
  AXES_SYSTEM_PROMPT,
  AXIS_KEYS,
  AXIS_LABELS,
  buildAxesUserPrompt,
  extractAxesHeuristic,
  parseLlmAnalysis,
  type LlmLectureAnalysis,
} from '../lib/honey/axes.ts';
import {
  buildAllLectures,
  HEURISTIC_PROVENANCE,
  LLM_PROVENANCE,
  SEED_PROVENANCE,
  type LectureMeta,
} from '../lib/honey/pipeline.ts';
import { kstYear } from '../lib/datetime.ts';
import { LECTURE_SEEDS } from './seed-corpus.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const MAX_TOKENS = 2000;

/* ────────────────────────────────────────────────────────────────────────────
 * LLM 호출
 * ──────────────────────────────────────────────────────────────────────────*/

type TextCaller = (systemPrompt: string, userPrompt: string) => Promise<string>;

/** 공식 SDK 가 설치돼 있으면 그걸 쓴다. 계산된 specifier 라 미설치 시 타입체크는 통과. */
async function trySdkCaller(): Promise<TextCaller | null> {
  const specifier = '@anthropic-ai/sdk';
  try {
    const mod = (await import(specifier)) as { default: new () => unknown };
    const Anthropic = mod.default;
    const client = new Anthropic() as {
      messages: {
        create: (args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[] }>;
      };
    };
    return async (systemPrompt, userPrompt) => {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // 시스템 프롬프트는 강의마다 동일 → 프롬프트 캐시가 그대로 먹는다
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      });
      return res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    };
  } catch {
    return null;
  }
}

/** SDK 가 없을 때의 raw HTTP 경로. */
function fetchCaller(apiKey: string): TextCaller {
  return async (systemPrompt, userPrompt) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body = (await res.json()) as { content: { type: string; text?: string }[] };
    return body.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  };
}

async function resolveCaller(): Promise<{ call: TextCaller; via: string } | null> {
  const sdk = await trySdkCaller();
  if (sdk) return { call: sdk, via: '@anthropic-ai/sdk' };
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return { call: fetchCaller(key), via: 'fetch → api.anthropic.com' };
  return null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 시드 로딩
 * ──────────────────────────────────────────────────────────────────────────*/

interface SeedFile {
  lectures: LectureMeta[];
  reviews: LectureReview[];
}

function loadSeed(): SeedFile {
  const p = join(DATA, 'reviews.seed.json');
  if (!existsSync(p)) {
    throw new Error('data/reviews.seed.json 이 없습니다. 먼저 `node scripts/make-seeds.ts` 를 실행하세요.');
  }
  return JSON.parse(readFileSync(p, 'utf8')) as SeedFile;
}

function groupReviews(reviews: LectureReview[]): Map<string, LectureReview[]> {
  const map = new Map<string, LectureReview[]>();
  for (const r of reviews) {
    const list = map.get(r.lectureId);
    if (list) list.push(r);
    else map.set(r.lectureId, [r]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(b.semester).localeCompare(String(a.semester)));
  }
  return map;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 검증 — 휴리스틱이 시드의 "진짜 축"을 얼마나 복원하는가
 * ──────────────────────────────────────────────────────────────────────────*/

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return Number.NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? Number.NaN : num / Math.sqrt(dx * dy);
}

/** 검증 최소 표본 — 이보다 적은 강의는 축 추정 자체가 불안정해 검증에서 제외 */
const VERIFY_MIN_REVIEWS = 8;

function verifyHeuristic(byLecture: Map<string, LectureReview[]>): void {
  console.log('\n휴리스틱 축 추출 검증 (시드 생성에 쓴 "진짜 축" 대비 상관계수):');

  const included = LECTURE_SEEDS.filter(
    (seed) => (byLecture.get(seed.id) ?? []).length >= VERIFY_MIN_REVIEWS,
  );

  const axisRows = AXIS_KEYS.map((key, axisIdx) => {
    const truth: number[] = [];
    const got: number[] = [];
    for (const seed of included) {
      truth.push(seed.truth[axisIdx]);
      got.push(extractAxesHeuristic(byLecture.get(seed.id) ?? []).axes[key]);
    }
    const r = pearson(truth, got);
    console.log(`  ${key.padEnd(22)} r = ${Number.isNaN(r) ? 'n/a' : r.toFixed(3)}  (n=${truth.length})`);
    return {
      axis: key,
      label: AXIS_LABELS[key],
      correlation: Number.isNaN(r) ? null : Math.round(r * 1000) / 1000,
      lectureCount: truth.length,
    };
  });

  // 강의별 진짜 축 vs 추출 축 (슬라이드에서 산점도로 쓸 수 있게)
  const perLecture = included.map((seed) => {
    const reviews = byLecture.get(seed.id) ?? [];
    const extracted = extractAxesHeuristic(reviews);
    return {
      id: seed.id,
      name: seed.name,
      reviewCount: reviews.length,
      truth: Object.fromEntries(AXIS_KEYS.map((k, i) => [k, seed.truth[i]])),
      extracted: extracted.axes,
      keywordHits: extracted.hits,
    };
  });

  const payload = {
    note: '휴리스틱 축 추출의 정확도 검증. `node scripts/score-lectures.ts --verify` 로 재생성.',
    caveat:
      '이 수치는 우리가 만든 시드 강의평을 상대로 잰 것이라 상한선에 가깝다. ' +
      '실제 강의평에서는 더 낮게 나올 것이므로 "휴리스틱 정확도"로 일반화하면 안 된다.',
    method: `시드 생성에 쓴 "진짜 축"(LECTURE_SEEDS.truth)과 키워드 휴리스틱 추출값의 피어슨 상관계수. 강의평 ${VERIFY_MIN_REVIEWS}건 이상인 강의만 대상.`,
    generatedAt: new Date().toISOString(),
    minReviews: VERIFY_MIN_REVIEWS,
    lectureCount: included.length,
    axes: axisRows,
    perLecture,
  };

  mkdirSync(DATA, { recursive: true });
  writeFileSync(join(DATA, 'honey-verify.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\n→ data/honey-verify.json 저장 (강의 ${included.length}개 기준)`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 메인
 * ──────────────────────────────────────────────────────────────────────────*/

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const forceHeuristic = args.includes('--heuristic');
  const verifyOnly = args.includes('--verify');

  const seed = loadSeed();
  const byLecture = groupReviews(seed.reviews);

  if (verifyOnly) {
    verifyHeuristic(byLecture);
    return;
  }

  const resolved = forceHeuristic ? null : await resolveCaller();
  const llmById: Record<string, LlmLectureAnalysis | undefined> = {};
  let llmOk = 0;
  let llmFail = 0;

  if (resolved) {
    console.log(`LLM 경로: ${resolved.via} · 모델 ${MODEL}`);
    for (const meta of seed.lectures) {
      const reviews = byLecture.get(meta.id) ?? [];
      if (reviews.length === 0) continue;
      const userPrompt = buildAxesUserPrompt(meta, reviews);
      try {
        const raw = await resolved.call(AXES_SYSTEM_PROMPT, userPrompt);
        const parsed = parseLlmAnalysis(raw);
        if (parsed) {
          llmById[meta.id] = parsed;
          llmOk += 1;
          console.log(`  ✓ ${meta.id} ${meta.name}`);
        } else {
          llmFail += 1;
          console.log(`  ! ${meta.id} ${meta.name} — 응답 파싱 실패, 휴리스틱으로 폴백`);
        }
      } catch (err) {
        llmFail += 1;
        console.log(
          `  ! ${meta.id} ${meta.name} — ${err instanceof Error ? err.message : String(err)} → 휴리스틱으로 폴백`,
        );
      }
    }
  } else {
    console.log(
      forceHeuristic
        ? '--heuristic 플래그: LLM 을 건너뛰고 키워드 휴리스틱만 사용합니다.'
        : 'ANTHROPIC_API_KEY 가 없고 SDK 도 없습니다 → 결정론적 키워드 휴리스틱으로 진행합니다.',
    );
  }

  const mode: 'llm' | 'heuristic' = llmOk > 0 ? 'llm' : 'heuristic';
  const lectures: Lecture[] = buildAllLectures(seed.lectures, seed.reviews, {
    currentYear: kstYear(),
    llmById,
    provenanceNotes: [SEED_PROVENANCE],
  });

  mkdirSync(DATA, { recursive: true });
  writeFileSync(
    join(DATA, 'lectures.json'),
    `${JSON.stringify(
      {
        note: '빌드 타임 산출물. 앱은 이 파일만 읽는다 (런타임에 API 키 불필요).',
        generatedAt: new Date().toISOString(),
        mode,
        model: mode === 'llm' ? MODEL : null,
        source: 'data/reviews.seed.json (시드/가상 강의평)',
        llmOk,
        llmFail,
        lectures,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const scored = lectures.filter((l) => l.honeyScore !== null);
  const top = [...scored].sort((a, b) => (b.honeyScore ?? 0) - (a.honeyScore ?? 0)).slice(0, 5);

  console.log(`\n→ data/lectures.json 저장 (mode=${mode}, 강의 ${lectures.length}개)`);
  if (resolved) console.log(`   LLM 성공 ${llmOk} / 폴백 ${llmFail}`);
  console.log(`   ${mode === 'llm' ? LLM_PROVENANCE : HEURISTIC_PROVENANCE}`);
  console.log('\n꿀강 Top 5 (축소 적용 후):');
  for (const l of top) {
    console.log(
      `  ${String(l.honeyScore).padStart(3)}점  ${l.name.padEnd(14)} 강의평 ${String(l.reviewCount).padStart(2)}건 · 신뢰도 ${l.reliability.band}${l.reliability.flags.length ? ` · ${l.reliability.flags.join(',')}` : ''}`,
    );
  }
}

main().catch((err) => {
  console.error('score-lectures 실패:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
