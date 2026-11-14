# BOKAK 2.0 아키텍처·TypeScript 계약 초안

상태: PHASE 0 / 2026-11-12 KST. 이 문서의 코드는 합의용 타입·인터페이스이며 실행 파일이나 구현이 아니다. 루트 CONTRACT.md는 유지한다.

## 구조와 경계

기존 Next.js 16 App Router / React 19 / TypeScript / Tailwind 4를 유지한다. 기존 app, components, lib 구조에 신규 영역을 추가하며 파일 이동은 별도 단계로 미룬다.

```text
app/dex/meal/                         B: 탐색·수집 목록·상세
app/dex/people/                       C: 인연 목록·상세
app/dex/custom/                       C: 도감·항목 CRUD
app/api/dex/meals/                    B: 필요 시 공용 데이터 read-only API
lib/dex/core/                        A: 공통 모델·수집 서비스·repository 계약
lib/dex/storage/                     A: IndexedDB·버전 이전·내보내기/가져오기
lib/dex/meal/                        B: Dish/Alias/Offering·기존 식단 어댑터
lib/dex/people/                      C: 인연 검증·메시지 조건
lib/dex/custom/                      C: 자유도감 검증·CRUD
components/dex/meal/                 B: 학식 기능 UI
components/dex/people/               C: 인연 기능 UI
components/dex/custom/               C: 자유도감 기능 UI
components/dex/common/               D: 카드·목록·폼·공통 UI
components/dex/discovery/            D: 연출·포커스·모션 감소
data/dex/meal-aliases.json            B: 공용 별칭만, 개인 데이터 금지
scripts/dex/                        A/B: 검증·명시적 동기화
각 기능 폴더/__tests__/              해당 소유자
```

Server Component/Route Handler는 기존 파일 식단을 읽고 직렬화 가능한 DTO를 전달한다. Client Component는 선택·편집·IndexedDB·연출을 담당한다. IndexedDB 접근은 모듈 import/서버 렌더 시 실행하지 않고 클라이언트 초기화 이후 실행한다. 읽는 동안 loading/empty/error를 구분해 hydration 불일치를 피한다.
lib/meal/store.ts·crawler.ts는 node:fs 의존이 있어 클라이언트 import 금지다. A의 순수 core는 React·Next·fs·IndexedDB에 의존하지 않고 저장 포트를 주입받는다. D의 공통 UI는 기존 components/data.ts·mock.ts·grade/honey store를 import하지 않는다.

## 공통 데이터 모델

아래 타입은 구현 전에 합의한다. 문자열 날짜/ID는 런타임 검증이 필요하며 TypeScript만으로 유효성을 보장하지 않는다. ID는 지속적인 불투명 문자열로 생성하고 배열 순서·메뉴명에서 재계산하지 않는다.

```ts
type Id = string;
type LocalDate = string; // YYYY-MM-DD, 실제 달력 날짜 검증
type Instant = string;   // UTC ISO timestamp
type DexKind = 'meal' | 'people' | 'custom';
type Cafeteria = 'haksik' | 'changbo' | 'dorm' | 'faculty';
type MealTime = 'breakfast' | 'lunch' | 'dinner';
type Rating = 1 | 2 | 3 | 4 | 5;

interface Versioned {
  id: Id;
  revision: number;
  createdAt: Instant;
  updatedAt: Instant;
}

interface Dex extends Versioned {
  ownerId: Id; // 로컬 프로필 식별자. 서버 인증 증명 아님
  kind: DexKind;
  name: string;
  icon: string; // 허용된 아이콘 키, 임의 HTML/스크립트 금지
  visibility: 'private'; // 제품 의도. 브라우저 프로필 접근 통제 의미 아님
  progress:
    | { mode: 'count-only' }
    | { mode: 'bounded'; targetSetId: Id; targetSetVersion: number };
}

interface Dish extends Versioned {
  canonicalName: string;
  variant: string | null;
  normalizationVersion: number;
  status: 'active' | 'redirected';
  redirectToDishId: Id | null; // 병합 이력, 순환 금지
}

interface DishAlias extends Versioned {
  source: string;
  rawName: string;
  normalizedKey: string; // 후보 검색 키이며 Dish PK가 아님
  cafeteria: Cafeteria | null; // null이면 공통 별칭
  dishId: Id;
  normalizationVersion: number;
  decision: 'curated' | 'exact-rule';
}

interface MealSnapshot {
  name: string | null;
  menu: string[];
  price: number | null;
  kcal: number | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
}

interface MealOffering extends Versioned {
  legacyMealItemId: string;
  sourceRecordKey: string; // 기존 ID의 순서 변화 문제를 보완하는 안정 식별자
  date: LocalDate;
  cafeteria: Cafeteria;
  mealTime: MealTime;
  resolution:
    | { state: 'resolved'; dishId: Id; aliasId: Id; aliasRevision: number }
    | { state: 'unresolved'; reason: 'missing-name' | 'ambiguous' | 'unmapped' };
  snapshot: MealSnapshot;
  soldOut: boolean;
  provenance: {
    source: string;
    mode: 'live' | 'cache' | 'seed' | 'mock';
    lastSuccessfulFetchAt: Instant | null;
    lastAttemptAt: Instant | null;
  };
}

type EntrySubject =
  | { kind: 'meal'; dishId: Id; displayNameSnapshot: string }
  | {
      kind: 'person'; displayName: string;
      admissionYear?: number; department?: string;
      relationship?: string; memo?: string;
    }
  | { kind: 'custom'; title: string; memo?: string };

interface CollectionEntry extends Versioned {
  ownerId: Id;
  dexId: Id;
  subject: EntrySubject;
  firstCollectedAt: Instant;
  collectedOn: LocalDate; // 사용자가 지정한 수집일, 시스템 저장 시각과 구분
}

interface ExperienceBase extends Versioned {
  ownerId: Id;
  dexId: Id;
  entryId: Id;
  requestId: Id;
  experiencedOn: LocalDate;
  note: string;
}
type Experience = ExperienceBase & (
  | {
      kind: 'meal'; rating: Rating | null;
      offeringId: Id;
      context: {
        date: LocalDate; cafeteria: Cafeteria; mealTime: MealTime;
        legacyMealItemId: string;
        snapshot: MealSnapshot;
        source: string;
      };
    }
  | { kind: 'person'; event: 'first-met' | 'memory' }
  | { kind: 'custom' }
);

interface CollectionRequestReceipt {
  ownerId: Id;
  requestId: Id;
  operation: 'collect-meal';
  payloadFingerprint: string;
  entryId: Id;
  experienceId: Id;
  originalEntryWasCreated: boolean;
  committedAt: Instant;
}
```

인연 경험에는 rating이 존재하지 않는다. 자유 항목에도 MVP에서는 별점을 붙이지 않는다. CollectionEntry.subject.kind는 소속 Dex.kind와 대응해야 한다(meal→meal, person→people, custom→custom). 이름·메모를 분석해 외부로 보내지 않는다.

## 저장 불변식

- 개인 학식 카드 unique key는 (ownerId, dexId, subject.dishId). 같은 Dish의 재방문은 Experience만 추가한다. 인연은 표시 이름으로 unique 처리하지 않는다.
- 요청 receipt unique key는 (ownerId, requestId). 동일 canonical payload는 기존 결과 반환, 다른 payload면 REQUEST_ID_CONFLICT다. canonical serialization/fingerprint 규칙을 A가 고정한다.
- 한 IndexedDB readwrite transaction에서 요청 검사 → 카드 조회/생성 → 경험 추가 → receipt 쓰기를 완료한다. request success 이벤트만으로 성공 반환하지 않고 transaction complete를 기다린다. transaction 중 네트워크/사용자 입력을 기다리지 않는다.
- 중복 탭에서도 unique index와 같은 transaction 범위로 카드/경험 중복을 방지한다. 실패 시 부분 카드·receipt를 남기지 않는다.
- firstCollectedAt은 최초 카드 생성 시각이다. 방문 횟수와 최근 평가는 Experience에서 계산한다. 경험 날짜는 생성 시각과 구분한다.
- 카드/도감 삭제는 소속 Experience를 같은 transaction에서 삭제한다. 요청 receipt는 초기 MVP에서 계속 보존하고 삭제된 결과의 재전송은 RESULT_DELETED를 반환한다(자동 부활 금지). 전체 기록 초기화 시에는 새 ownerId를 만든다.
- 경험만 삭제하면 카드는 남는다. 빈 카드도 명시적 카드 삭제 전까지 보존한다. 최근 별점·횟수는 재계산한다.
- 업데이트/삭제는 expectedRevision을 검사한다. 다른 탭 변경을 덮어쓰지 않고 REVISION_CONFLICT를 반환한다.
- 공용 Dish/Offering은 개인 카드 삭제의 cascade 대상이 아니다. 메뉴 병합은 명시적 매핑 버전·별도 개인 기록 이전으로 처리한다. 카드 이름/ID를 조회 중 조용히 바꾸지 않는다.
- menu name이 없거나 매칭이 불명확하면 unresolved다. 원문·기존 ID·스냅샷을 보존하고 초기 collect는 막아 확인 경로를 제공한다. 시드/mock는 실제 개인 수집에 넣지 않는다.
- DishAlias의 같은 source/scope/key에 여러 Dish 후보가 생기면 ambiguous로 처리한다. 한영 병기·행사 접두어·띄어쓰기 정규화는 후보 추출용이며 변형 메뉴를 자동 합치지 않는다.

## A/B/D 인터페이스

```ts
type DexErrorCode =
  | 'INVALID_INPUT' | 'UNRESOLVED_MENU' | 'DEMO_DATA'
  | 'REQUEST_ID_CONFLICT' | 'RESULT_DELETED' | 'REVISION_CONFLICT'
  | 'STORAGE_UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'NOT_FOUND';
type Result<T> = { ok: true; value: T }
  | { ok: false; error: { code: DexErrorCode; message: string } };

// B: 서버 전용. readMealCrawl/readMealsByDate 기반, ensureFresh* 호출 금지.
interface MealCatalogPort {
  readOfferings(query: {
    date: LocalDate; cafeteria?: Cafeteria; mealTime?: MealTime;
  }): Promise<Result<{ offerings: MealOffering[]; warnings: string[] }>>;
}

// B: 실제 core 호출 전 클라이언트에서 사용하는 직렬화 가능한 선택값.
interface ResolvedMealSelection {
  dishId: Id;
  dishName: string;
  offering: MealOffering & {
    resolution: {
      state: 'resolved'; dishId: Id; aliasId: Id; aliasRevision: number;
    };
  };
}
interface CollectMealCommand {
  ownerId: Id;
  dexId: Id;
  requestId: Id; // 실패 재시도는 유지, 새 재방문만 새 ID
  selection: ResolvedMealSelection;
  experiencedOn: LocalDate;
  rating: Rating | null;
  note: string;
}
interface CollectMealResult {
  entry: CollectionEntry;
  experience: Experience;
  outcome: 'new-entry' | 'revisit';
  replayed: boolean;
  committedAt: Instant;
  discovery: { key: Id; title: string; entryId: Id } | null;
}

// A: IndexedDB 어댑터가 구현. 입출력 검증은 core에서, 원자성은 repository에서.
interface DexRepository {
  open(): Promise<Result<{ ownerId: Id; schemaVersion: number }>>;
  commitMealCollection(command: CollectMealCommand): Promise<Result<CollectMealResult>>;
  listEntries(ownerId: Id, dexId: Id): Promise<Result<CollectionEntry[]>>;
  listExperiences(ownerId: Id, entryId: Id): Promise<Result<Experience[]>>;
}
declare function collectMeal(
  command: CollectMealCommand, repository: DexRepository,
): Promise<Result<CollectMealResult>>;

// D: 데이터 쓰기를 하지 않는 UI 포트. 연출 실패로 수집을 롤백하지 않는다.
interface DiscoveryPresenter {
  present(event: NonNullable<CollectMealResult['discovery']>, options: {
    reducedMotion: boolean;
  }): Promise<void>;
}
```

권장 데이터 흐름: B readOfferings → B 기능 UI 선택 → B collectMeal 호출(A 계약) → A 검증·원자 저장 → B 결과 표시 → discovery가 있고 replayed=false일 때 D 연출 → A repository 목록/이력 재조회.
outcome은 원본 요청의 결과다. replayed=true이면 discovery=null이며 원래 outcome이 new-entry라도 연출하지 않는다. 서버 저장과 연출의 완전한 exactly-once는 보장하지 않으며 충돌 재시도에서 연출을 재생하지 않는 것을 우선한다.
selection.dishId와 offering.resolution.dishId 일치, Dex.kind/ownerId 일치, 실제 출처, 별점·날짜·길이 등을 A가 검증한다. B는 불투명 Dish ID를 공급하고 D는 판정/저장을 중복 구현하지 않는다.

C의 서비스도 같은 repository 기반 revision/소유권/원자성 원칙을 따른다. 초기 함수 계약은 아래와 같다. C가 도메인 검증을 작성하고 A가 저장 계약을 승인한다. 범용 임의 필드/임의 스크립트 실행 엔진을 만들지 않는다.

```ts
interface WriteContext { ownerId: Id; requestId: Id }
interface RevisionTarget { id: Id; expectedRevision: number }
interface PersonDraft {
  displayName: string;
  admissionYear?: number;
  department?: string;
  relationship?: string;
  memo?: string;
  collectedOn: LocalDate;
}
interface CustomItemDraft { title: string; memo?: string; collectedOn: LocalDate }
interface PersonalDexService {
  createCustomDex(ctx: WriteContext, draft: {
    name: string; icon: string;
  }): Promise<Result<Dex>>;
  updateCustomDex(ctx: WriteContext, target: RevisionTarget, patch: {
    name?: string; icon?: string;
  }): Promise<Result<Dex>>;
  deleteCustomDex(ctx: WriteContext, target: RevisionTarget): Promise<Result<void>>;
  addPerson(ctx: WriteContext, dexId: Id, draft: PersonDraft): Promise<Result<CollectionEntry>>;
  updatePerson(ctx: WriteContext, target: RevisionTarget, draft: PersonDraft): Promise<Result<CollectionEntry>>;
  addCustomItem(ctx: WriteContext, dexId: Id, draft: CustomItemDraft): Promise<Result<CollectionEntry>>;
  updateCustomItem(ctx: WriteContext, target: RevisionTarget, draft: CustomItemDraft): Promise<Result<CollectionEntry>>;
  deleteEntry(ctx: WriteContext, target: RevisionTarget): Promise<Result<void>>;
  listEntries(ownerId: Id, dexId: Id): Promise<Result<CollectionEntry[]>>;
  getEntry(ownerId: Id, entryId: Id): Promise<Result<CollectionEntry>>;
}
```

addPerson/addCustomItem은 첫 경험도 같은 transaction에서 만들며, 같은 write 요청의 재전송은 기록을 늘리지 않는다. 위 receipt의 operation은 구현 전 C의 CRUD별 판별 유니온으로 확장해야 한다. 카드 수정은 별도 경험을 자동 추가하지 않는다. person 등록 메시지는 저장 성공 결과를 바탕으로 C가 조건을 고르고 D가 표시한다. updatePerson의 collectedOn 변경은 카드의 표시 수집일만 바꾸며 첫 경험 날짜 정정은 별도 경험 편집으로 처리한다. addCustomItem도 같은 규칙이다. 이는 합의용 초안이며 C 기능은 첫 학식 수직 기능 범위에 포함하지 않는다.

## IndexedDB 결정안

초기 비로그인 1인용 MVP에 적합하다. 비동기·구조화 레코드·인덱스·원자적 다중 store transaction이 필요하고 현재 파일 JSON은 다중 사용자 소유권/브라우저 영속 저장을 해결하지 못한다.

제안 DB: bokak.dex, version 1. stores: meta(local profile/schema), dexes, entries, experiences, requestReceipts. 공용 Dish/Alias/Offering은 B의 공급 계층에 두며 필요할 때 공용 캐시만 별도 저장한다. 경험은 공급 캐시가 없어도 읽을 수 있게 스냅샷을 가진다.
제안 인덱스: entries [ownerId,dexId], 학식 항목에만 존재하는 mealUniqueKey의 unique index; experiences [ownerId,entryId], [ownerId,dexId]; requestReceipts [ownerId,requestId] unique. person/custom에 undefined unique key를 둬 충돌시키지 않는다. 실제 인덱스 선언은 A가 확정한다.

- 브라우저 storage 오류·quota·blocked upgrade를 사용자에게 알린다. versionchange 시 연결을 닫고 다른 탭 새로고침을 안내한다.
- navigator.storage.persist()는 구현 시 capability detection 후 선택적으로 요청하되 보존 보장으로 표현하지 않는다.
- origin/포트별 저장 분리 때문에 팀원 개발 환경에서는 고정 origin을 정하고 사용자에게 변경 전 내보내기를 안내한다.
- export에는 format='bokak-dex', schemaVersion, exportedAt, local profile, Dex/Entry/Experience/receipt, 필요한 메뉴 참조 스냅샷을 포함한다. 서버 토큰·환경변수·원본 이미지 바이너리는 포함하지 않는다. 이미지 URL은 오프라인 사진 보장을 하지 않는다.
- import preview에서 파일 크기·스키마·지원 버전·날짜·문자 길이·ID·참조 무결성·종류·owner 관계·중복키·receipt 일치를 검증한다. 무효 파일/미지원 미래 버전은 기존 DB를 건드리지 않는다.
- 초기 복원은 검증→건수 미리보기→사용자 확인→현재 기록 export 권고→단일 transaction 전체 교체다. 자동 merge는 하지 않는다. DB 연결을 닫는 다른 탭과 충돌하지 않도록 가져오기 중 편집을 막는다. 가져오기 receipt도 보존해 요청 의미가 바뀌지 않게 한다.
- IndexedDB 버전 이전 실패 시 기존 store를 임의 초기화하지 않는다. 내보내기/오류 복구를 제공한다.
- 서버 계정 도입은 별도 단계다. 인증된 사용자 소유권 검증, 로컬→계정 명시적 이전, 동기화 충돌·삭제 tombstone·재시도 정책이 필요하다. 현재 ownerId는 인증 수단이 아니다.

```ts
interface ImportPreview {
  token: Id; // 검증한 파일 내용과 DB revision에 결합, 변경되면 재검증
  counts: { dexes: number; entries: number; experiences: number };
  warnings: string[];
}
interface TransferPort {
  exportRecords(ownerId: Id): Promise<Result<Blob>>;
  previewImport(file: Blob): Promise<Result<ImportPreview>>;
  commitImport(input: {
    token: Id; strategy: 'replace'; confirmed: true;
  }): Promise<Result<{ ownerId: Id }>>;
}
```

가져오기 검증 오류 코드와 미지원 스키마 오류는 구현 전 DexErrorCode에 추가한다. token은 비밀 인증 토큰이 아니라 동일 검증 대상·저장 상태 확인용이며 preview 단계에서 데이터를 쓰지 않는다.

## 기존 학식 연결과 자동 크롤링 제거 계획

실제 현재 경로:

| 진입점 | 호출 | 쓰기 영향 |
|---|---|---|
| npm dev/build/start | predev/prebuild/prestart → npm run crawl | meals.json, 사진, photo DB |
| Next 서버 시작 | instrumentation.register → ensureFreshMealCrawl(force:true) | 동일 |
| GET /api/meals | ensureFreshMealsByDate → ensureFreshMealCrawl | 동일 |
| GET /api/meals/status | ensureFreshMealCrawl | 동일 |
| GET /api/meals/battle | ensureFreshBattle → ensureFreshMealCrawl | 동일 |
| seed/demo:refresh/data:all | 시드/크롤/분석 생성 체인 | 여러 data 산출물 |
| POST /api/meals/review | createMealReview → writeMealReviews | 기존 공용 후기 JSON |

따라서 npm --ignore-scripts만으로 데이터 쓰기를 막을 수 없다. PHASE 0는 서버·빌드·테스트·크롤러를 실행하지 않는다.

다음 안전 패치(실제 기능 개발에 선행):

1. 새 워크트리에서만 lifecycle의 크롤 연결 제거. 크롤러 CLI 구현 자체는 유지한다.
2. instrumentation의 자동 수집 제거. 단순 환경변수 설정만으로 숨기지 않고 기본 동작을 무수집으로 만든다.
3. 식단/상태/대결 GET을 read-only 경로로 전환하고 refresh=1이 쓰기를 유발하지 않게 한다. 신규 UI는 기존 공용 후기 POST를 호출하지 않는다.
4. 개발용 명시적 CLI만 동기화 경계로 둔다. 일반 앱 요청은 runMealCrawler를 호출하지 않는다. 외부 수집은 승인된 명시 작업 또는 향후 별도 스케줄 작업이다.
5. read-only 신규 API는 private .env/인연 데이터 없이 공용 식단 DTO만 반환한다. 캐시 없음·오래됨·seed를 정직하게 표시한다.
6. Node 준비 후 네트워크 mock·임시 데이터 디렉터리로 dev/build/start/API 쓰기 부재를 검증한다. 기준 data/public 해시 비교, 호출 그래프 확인, refresh와 오류/폴백까지 확인한다. 기존 종료코드 계약 테스트는 유지한다.

현재 crawler는 날짜별 코너를 순서로 번호 매기고, meals.json을 최근 결과로 교체하며, photo DB는 사진 있는 식단만 누적한다. 과거 개인 기록의 유일 참조로 사용하지 않는다. 새 adapter는 원본 JSON을 변경하지 않으며 legacyMealItemId와 원문 스냅샷을 남긴다. 마지막 성공 수집 시각과 최근 실패 시각도 구분한다.

## 검증 계획

모델/정규화 순수 테스트, 임시 IndexedDB 저장 계약 테스트, 실제 브라우저 새로고침·동시 탭·quota/실패·import/export, 연출 접근성 검증이 필요하다. 테스트 도구 의존성 추가는 A가 검토한다. 테스트용 fixture에 실제 인연 데이터를 쓰지 않는다.
PHASE 0에서는 문서만 작성한다. 타입 블록 컴파일·IndexedDB 실행·npm test·build 통과를 주장하지 않는다.
