# 공통 대학도감 기반 — A/B/C/D 인수 가이드

이 코드는 PHASE 2 공통 기반이다. 기존 학점·꿀강·학식 공급 데이터를 수정하지 않는다. 도메인별 완성 화면과 메뉴 정규화는 후속 작업이다.

## 파일 경계

- A: `core/types.ts`, `engine.ts`, `validation.ts`, `storage/**`와 테스트.
- B: `meal/types.ts`의 공급 데이터 계약과 `app/dex/meal/page.tsx` 인수. PHASE 2에서는 타입과 얇은 진입점만 만들었다.
- C: `app/dex/people/page.tsx`, `app/dex/custom/page.tsx` 인수. 최종 도메인 컴포넌트는 아직 없다.
- D: `components/dex/scaffold/**`의 임시 화면을 공통 UI/도메인 UI/발견 연출로 교체. 기존 디자인 토큰과 Card를 사용했으며 기존 AppShell·TabBar·홈은 바꾸지 않았다.

`core/index.ts`는 타입과 collect/collectMeal의 공개 진입점이다. `engine.applyCollection`은 저장 어댑터 내부의 순수 유스케이스이며 직접 호출해서 저장 완료로 간주하면 안 된다.

## Client에서 시작하기

```ts
import { getBrowserRepository } from '@/lib/dex/storage/browser';

// Client effect 또는 이벤트에서 실행. 모듈 import/서버 렌더 단계에서 실행하지 않는다.
const repo = getBrowserRepository();
const opened = await repo.open();
if (!opened.ok) {
  // 초기화하지 말고 opened.error를 보여준다. 손상 시 exportRecovery 제공.
  return;
}
const ownerId = opened.value.ownerId;
const dexes = await repo.listDexes(ownerId);
```

open은 빈 DB일 때만 학식·인연의 빈 기본 도감을 만든다. 사용자 수집 카드·경험·자유도감은 만들지 않는다. 사용자가 도감을 삭제한 뒤 open을 호출해도 그 도감을 자동 부활시키지 않는다.
ownerId는 이 브라우저 로컬 프로필의 분리 키다. 서버 인증이나 다른 기기 계정이 아니며 계정 도입 시 명시적인 이전·인증된 소유권 검사가 별도로 필요하다.

## B — 학식 공급 DTO 연결

```ts
import { collectMeal } from '@/lib/dex/core';
import type { ResolvedMealSelection, CollectMealCommand } from '@/lib/dex/core';

// B가 read-only catalog에서 제공. 식단 ID 대신 지속적인 dishId를 식별한다.
declare const selection: ResolvedMealSelection;
declare const mealDexId: string;
const command: CollectMealCommand = {
  ownerId, dexId: mealDexId,
  requestId: crypto.randomUUID(), // 의도적인 새 방문에만 새 값 생성
  selection, experiencedOn: '2026-11-13', rating: null, note: '',
};
const result = await collectMeal(command, repo);
// repo.commitMealCollection(command)도 같은 호환 포트다.
if (result.ok && !result.value.replayed && result.value.discovery) {
  // D의 presenter.present(result.value.discovery, { reducedMotion })에 전달
}
```

실패 재시도에는 command의 requestId와 내용을 그대로 유지한다. 같은 requestId + 다른 내용은 REQUEST_ID_CONFLICT다. 같은 메뉴의 새 requestId는 카드 하나에 새 경험을 추가한다. 재전송 결과의 outcome은 원본 요청의 결과이며 replayed=true/discovery=null로 연출을 억제한다. 커밋 직후 화면이 종료되는 경우까지 연출 exactly-once를 보장하는 계약은 아니다.
PHASE 3에서 B는 기존 읽기 API, source/alias 매핑, 메뉴 변형·미해결 정책, legacyMealItemId 안정성을 연결해야 한다. core는 메뉴 이름을 추정해 dishId를 만들거나 크롤링하지 않는다. 미식별·seed/mock selection은 collectMeal 포트에서 거부한다.

## C — 자유/인연 수집 및 CRUD

```ts
const made = await repo.createDex(ownerId, { kind: 'custom', name: '나의 캠퍼스', icon: 'place' });
if (!made.ok) return;
const first = await repo.collect({
  ownerId, dexId: made.value.id, requestId: crypto.randomUUID(),
  subject: { kind: 'custom', title: '직접 경험한 장소' },
  experience: { kind: 'custom', experiencedOn: '2026-11-13', note: '' },
});
if (!first.ok) return;
const revisit = await repo.collect({
  ownerId, dexId: made.value.id, requestId: crypto.randomUUID(),
  entryId: first.value.entry.id, subject: first.value.entry.subject,
  experience: { kind: 'custom', experiencedOn: '2026-11-14' },
});
```

인연은 subject.kind='person', 표시 이름과 선택 정보, experience.kind='person' 및 event='first-met'|'memory'를 사용한다. 같은 이름을 자동 합치지 않는다. 인연/자유 재방문은 entryId를 전달한다. 인연·자유 경험에 rating을 넘기면 런타임에서도 거부한다.
카드는 collect로 첫 경험과 함께 생성한다. updateDex/updateEntry/updateExperience 및 delete 계열은 마지막으로 조회한 revision을 전달한다. 오래된 revision은 REVISION_CONFLICT다. 카드/도감 삭제는 연결 경험까지 원자적으로 삭제하고, 경험만 삭제하면 카드가 남는다. 요청 영수증은 해시와 식별자를 보존해 삭제된 요청의 재전송이 기록을 부활시키지 않게 한다. 영수증에는 메모 원문을 저장하지 않는다.
메뉴의 dishId 변경은 일반 카드 수정에서 금지한다. 메뉴 병합/분리 이전은 별도 합의가 필요하다. 빈 메모는 허용하며 별점 미입력은 null이다. 날짜는 실제 달력 날짜, 한줄평·메모는 현재 500자 상한이며 제품별 더 짧은 제한은 도메인 UI에서 정할 수 있다.

## 저장과 오류 계약

- DB `bokak.dex`, version 1. meta/dexes/entries/experiences/requestReceipts로 분리한다.
- 메뉴 카드 unique index와 요청 영수증 PK가 중복을 방지한다. 인연/자유는 이름 기반 unique index가 없다.
- 요청을 검증/복사하고 SHA-256 지문을 계산한 **뒤** transaction을 연다. 정렬 직렬화 v1은 코드포인트 순서이며 외부 패키지에 의존하지 않는다.
- 하나의 readwrite transaction이 상태 읽기 → 순수 검증/변경 → 카드/경험/영수증 쓰기를 수행한다. 내부에서는 IDB callback만 이어 큐잉하고 네트워크·Promise·타이머를 기다리지 않는다.
- 성공 Result와 onCommitted는 transaction complete 이후에만 발생한다. 요청 success에서 성공을 표시하지 않는다. 오류/abort/quota는 전체 롤백된다.
- 현재 MVP는 전체 문서를 읽고 검증하는 보수적인 transaction 단위다. 작은 로컬 데이터의 일관성에 우선순위를 두었고 대규모 기록은 추후 인덱스 기반 증분 변경으로 최적화할 수 있다.
- 오염/손상/미지원 버전은 자동 초기화·삭제하지 않는다. CORRUPT_STORAGE/UNSUPPORTED_SCHEMA 등을 표시한다. versionchange에서는 연결을 닫고 blocked 업그레이드는 다른 탭 종료를 안내한다. 실지원 버전은 1이며 미래 버전 migration을 임의 추측하지 않는다.
- 내보내기/가져오기는 평문 JSON이다. 5MB 상한, 스키마·필드·날짜·ID·소유 범위·참조·중복 검증, preview token, 명시적 replace/confirmed 정책을 적용한다. 미리보기 뒤 DB가 바뀌면 IMPORT_CONFLICT다. 전체 교체도 한 transaction이므로 부분 복원은 없다.
- 손상 기록에는 정상 export 대신 exportRecovery를 제공한다. recovery 파일은 진단·수동 복구용이며 정상 import로 자동 수용하지 않는다. 검증된 정상 백업은 명시적 확인으로 손상 DB에 복원할 수 있다.
- 브라우저 프로필 공유·사이트 데이터 삭제·origin/포트 변경에 따른 한계를 안내한다. 암호화·로그인·서버 동기화는 제공하지 않는다.

## D — 화면과 연출

결과는 new-entry/revisit, replayed, discovery 또는 오류 Result다. presenter는 저장을 수행하지 않고 discovery를 표시한다. 모션 감소·건너뛰기·포커스 복원은 최종 연출 담당 구현 범위다.
골격의 useDexDocument는 실제 저장 기록만 조회하고 로컬 변경/BroadcastChannel/창 focus에 재조회한다. props.kind를 받는 DexLandingScaffold는 교체 가능한 임시 영역이다. 도메인별 CRUD 폼은 이 단계에 없다. 자유도감·인연에는 임의의 완료율을 표시하지 않는다.

## 실행 및 검증

```powershell
npm.cmd test
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js lib/dex components/dex app/dex --max-warnings 0
npm.cmd run dev
```

`/dex`와 `/dex/meal`, `/dex/people`, `/dex/custom`에서 실제 로컬 개수와 빈 상태를 확인한다.
개발 전용 `/dex/dev`: 최초 수집 → 재방문 → 동일 요청 재전송 → 새로고침 → 메모 수정 → 저장 실패 주입(건수 유지) → 최근 경험 삭제 순서로 검증한다. 독립 DB `bokak.dex.development-lab` / namespace development를 사용하며 개인 기록은 삭제·초기화하지 않는다. 개발 데이터는 개인 namespace로 가져올 수 없다. 프로덕션은 링크가 없고 경로는 404다.
다른 포트를 쓰면 별도 origin의 기록이므로 새로고침 복원 테스트는 같은 주소·프로필에서 수행한다. 기존 학식 갱신 명령은 검증 중 실행하지 않는다.

## PHASE 3 — 실제 학식도감 연결

학식 탐색은 `/dex/meal`, 개인 목록은 `/dex/meal/collection`, 상세는 `/dex/meal/collection/[entryId]`다.
기존 읽기 전용 `/api/meals/status` → `lib/dex/meal/catalog.ts` → 지속적인 dishId → 기존 `commitMealCollection`을 연결한다. 식단 조회/필터 변경만으로는 개인 기록을 저장하지 않는다. 명시적 수집 버튼은 기본 평가 없이 저장하고, 평가·메모는 상세에서 선택적으로 편집한다.
`MealCollectionRequests`가 클릭 동작별 requestId를 고정한다. 실패 재시도에는 같은 command를 쓰고, 확인된 실제 재방문에는 새 requestId를 쓴다. 결과의 outcome/replayed/discovery만 공통 피드백 UI에 전달한다.
대표 별점은 먹은 날짜·생성 시각 순으로 최근 평가가 있는 경험이며, 최신 경험이 미평가면 이전 평가를 유지한다. 개별 경험 삭제와 카드+전체 경험 삭제는 구분한다. 개인 평가를 공용 후기 API에 게시하지 않는다.
Chrome 실패 주입에서 이미 abort된 transaction을 다시 abort할 때의 예외를 확인해 공통 storage의 catch에 안전한 abort 가드를 보강했다. 공개 함수·모델·DB 버전은 변경하지 않았다.

- [메뉴 ID·별칭 정책](../../docs/dex/MEAL_ID_POLICY.md)
- [B·D 인수 가이드](../../docs/dex/MEAL_HANDOFF.md)
- [PHASE 3 구현·검증 보고서](../../docs/dex/PHASE3_REPORT.md)