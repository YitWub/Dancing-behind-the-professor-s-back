/**
 * crawl-meals.ts 종료코드 계약 테스트 (CONTRACT.md 8장)
 *
 * 지키는 것: **크롤 실패를 exit code 로 표현하지 않는다.**
 *
 * 이 계약이 깨지면 `demo:refresh` / `data:all` 의
 * `npm run crawl && npm run score` 체인이 크롤 실패 지점에서 끊긴다.
 * 그런데 **아무 에러도 안 난다** — 발표자는 돌렸다고 믿는데 lectures.json 만 안 갱신된다.
 *
 * "크롤링이 실패했는데 왜 exit 0 이지?" 는 그럴듯한 수정이라 더 위험하다.
 * 그래서 사람의 기억이 아니라 테스트로 고정한다.
 */

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import type { CrawlResult } from '../../types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'crawl-meals.ts');

// 레포의 data/meals.json 을 건드리지 않도록 임시 디렉터리로 출력한다
const workDir = mkdtempSync(join(tmpdir(), 'erica-crawl-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

function runCrawler(extraArgs: string[]): { status: number | null; out: string; outPath: string } {
  const outPath = join(workDir, `meals-${Math.random().toString(36).slice(2)}.json`);
  const res = spawnSync(
    process.execPath,
    ['--experimental-strip-types', SCRIPT, `--out=${outPath}`, ...extraArgs],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return { status: res.status, out: `${res.stdout}${res.stderr}`, outPath };
}

describe('crawl-meals.ts 종료코드 계약', () => {
  it('크롤링이 실패해도 exit 0 으로 끝난다 (&& 체인을 끊지 않기 위해)', () => {
    // --offline 은 네트워크를 건너뛰므로 "반드시 실패하는" 결정론적 경로다
    const { status, out } = runCrawler(['--offline']);
    assert.equal(
      status,
      0,
      `크롤 실패 시 exit ${status} 로 끝났습니다. ` +
        'CONTRACT 8장 위반 — demo:refresh 의 `crawl && score` 체인이 조용히 끊깁니다.\n' +
        `스크립트 출력:\n${out}`,
    );
  });

  it('실패는 exit code 대신 CrawlResult.ok=false 로 표현된다', () => {
    const { outPath } = runCrawler(['--offline']);
    const result = JSON.parse(readFileSync(outPath, 'utf8')) as CrawlResult;

    assert.equal(result.ok, false, '크롤에 실패했으므로 ok 는 false 여야 합니다');
    assert.ok(result.error, '실패 사유가 error 에 기록되어야 합니다');
    assert.ok(
      result.fallback === 'seed' || result.fallback === 'cache',
      `폴백 출처가 표시되어야 합니다 (받은 값: ${String(result.fallback)})`,
    );
  });

  it('실패해도 화면에 내보낼 식단을 비우지 않는다 (앱이 안 깨져야 함)', () => {
    const { outPath } = runCrawler(['--offline']);
    const result = JSON.parse(readFileSync(outPath, 'utf8')) as CrawlResult;

    assert.ok(result.items.length > 0, '폴백 식단이 비어 있으면 화면이 빈 채로 뜹니다');
    assert.ok(
      result.items.every((m) => m.menu.length > 0),
      '메뉴가 빈 항목이 섞여 있습니다',
    );
  });

  it('--out 이 지정되면 레포의 data/meals.json 을 건드리지 않는다', () => {
    const before = readFileSync(join(ROOT, 'data', 'meals.json'), 'utf8');
    runCrawler(['--offline']);
    const after_ = readFileSync(join(ROOT, 'data', 'meals.json'), 'utf8');
    assert.equal(after_, before, '테스트가 레포 데이터를 덮어썼습니다');
  });
});
