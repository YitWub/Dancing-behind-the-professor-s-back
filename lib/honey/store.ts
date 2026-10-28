/**
 * lib/honey/store.ts — 꿀강 데이터 읽기 (서버 전용)
 *
 * 1순위: data/lectures.json (scripts/score-lectures.ts 가 구운 결과)
 * 폴백 : data/reviews.seed.json 을 그 자리에서 휴리스틱으로 계산
 *        → 빌드 스크립트를 안 돌렸어도 꿀강 화면이 비지 않는다.
 *
 * ⚠️ 'node:fs' 사용. 클라이언트 컴포넌트에서 import 금지.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Lecture, LectureReview } from '../types.ts';
import { kstYear } from '../datetime.ts';
import { buildAllLectures, SEED_PROVENANCE, type LectureMeta } from './pipeline.ts';

const DATA_DIR = join(process.cwd(), 'data');

export interface LectureBundle {
  lectures: Lecture[];
  /** 축 추출에 LLM 을 썼는지 */
  mode: 'llm' | 'heuristic';
  /** 강의평 원본 출처 */
  source: string;
  generatedAt: string | null;
  /** data/lectures.json 이 없어서 런타임에 계산했는지 */
  computedAtRuntime: boolean;
}

interface BakedFile {
  generatedAt?: string;
  mode?: 'llm' | 'heuristic';
  source?: string;
  lectures?: Lecture[];
}

interface SeedFile {
  lectures?: LectureMeta[];
  reviews?: LectureReview[];
}

function readJson<T>(file: string): T | null {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function readLectureBundle(): LectureBundle {
  const baked = readJson<BakedFile>('lectures.json');
  if (baked?.lectures && baked.lectures.length > 0) {
    return {
      lectures: baked.lectures,
      mode: baked.mode ?? 'heuristic',
      source: baked.source ?? 'data/reviews.seed.json',
      generatedAt: baked.generatedAt ?? null,
      computedAtRuntime: false,
    };
  }

  const seed = readJson<SeedFile>('reviews.seed.json');
  if (!seed?.lectures || !seed.reviews) {
    return { lectures: [], mode: 'heuristic', source: '(없음)', generatedAt: null, computedAtRuntime: true };
  }
  return {
    lectures: buildAllLectures(seed.lectures, seed.reviews, {
      currentYear: kstYear(),
      provenanceNotes: [SEED_PROVENANCE],
    }),
    mode: 'heuristic',
    source: 'data/reviews.seed.json',
    generatedAt: null,
    computedAtRuntime: true,
  };
}

export function findLecture(id: string): Lecture | null {
  return readLectureBundle().lectures.find((l) => l.id === id) ?? null;
}
