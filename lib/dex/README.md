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

## 인연 보드 저장 계약 (PHASE 5B)
- 인연 Dex의 선택적 `peopleBoard: {version:1, positions:[{entryId,x,y}], edges:[{id,a,b}]}`를 기존 dexes 스토어에 저장한다. DB 버전/스토어는 변경하지 않으며 기존 레코드는 필드 없이 그대로 읽는다. 보드 열기 시 누락 카드의 초기 위치만 추가한다.
- 2400×1800 논리 좌표를 사용하며 카드 크기는 160×180이다. 위치는 경계 안으로 제한한다. 연결은 사용자가 고른 같은 Dex의 person Entry만 허용하며 정렬한 두 ID의 JSON 키로 무방향 중복을 방지한다.
- 공개 포트 `updatePeopleBoard(ownerId,dexId,revision,command)`는 initialize / move / connect / disconnect를 단일 트랜잭션으로 처리한다. revision 충돌은 자동 덮어쓰기 없이 재조회·재시도한다. 인연 삭제는 위치·연결·경험을 같은 트랜잭션에서 정리한다.
- 기본 보드는 백업 v3, 메모·실 스타일이 추가된 확장 보드는 **백업 v4**로 내보낸다. 보드가 없으면 v2를 유지하며 v1/v2/v3/v4 가져오기를 지원한다. 오래된 백업 전체 교체 시 새 배치·실도 제거되고, 다음 보드 진입 시 위치만 다시 초기화한다.
- 구버전 앱은 새 Dex 필드와 v3를 읽지 못하므로 보드 사용 후 예전 클라이언트로 돌아가지 않는다. 초기화나 다운그레이드하지 말고 업데이트한 앱으로 열어야 한다. 개인 인연과 보드 모두 로컬 기록이며 공용 식단 아카이브와 분리한다.

### 실 스타일·메모 (PHASE 5D-2A)
- 기존 보드 version:1은 그대로 읽고 style 누락은 red, notes 누락은 빈 목록으로 취급한다. 새 스타일 지정·메모 추가 시 같은 dexes 레코드를 version:2로 원자적으로 확장한다. DB 버전·스토어는 그대로다.
- edge.style은 red / olive / twine이며 관계 의미를 자동 부여하지 않는다. notes는 {id,text,color,x,y} 목록이며 인연·Experience가 아니다. 메모 크기는 200×180, 내용은 1~500자, 보드당 최대 500개이며 실제 빈 공간이 없으면 추가를 거부한다.
- add-note / edit-note / move-note / delete-note / style-edge는 기존 revision 검사·단일 트랜잭션을 사용한다. 생성 요청은 같은 메모 ID로 재시도하며, 실패 시 이전 레코드를 보존한다. 인연 삭제는 메모를 삭제하지 않는다.
- v4 전체 백업에 메모·스타일·기존 인연·추억·배치가 함께 포함된다. 이전 백업 전체 교체 시 새 꾸미기 데이터도 교체되므로 먼저 v4로 내보낸다. 구버전 앱은 새 보드 버전/v4를 읽지 못하므로 업데이트한 클라이언트만 사용한다. 기존 가져오기 제한은 JSON 5MB다.
- 사진 저장·마이그레이션·백업은 아래 PHASE 5D-2B 계약을 따른다.

### 추억 사진 (PHASE 5D-2B)
- IndexedDB DB_VERSION=2: v1 메타데이터 스토어는 유지하고 photoAssets({id,blob}) / photoAssetInfo({id,ownerId,mime,bytes,width,height,sha256})만 추가한다. blocked 업그레이드는 다른 탭 종료/새로고침을 안내한다. 다운그레이드·초기화하지 않는다.
- 사진 보드는 peopleBoard.version=3, photos:[{id,assetId,caption,size,x,y}]를 사용한다. 별도 Entry/Experience를 만들지 않으며 기존 메모·스타일 작업이 보드 버전을 낮추지 않는다. assetId는 최적화 이미지 SHA256 기반이며 같은 이미지의 복수 참조를 지원한다.
- 입력은 정적 JPEG/PNG/WebP, 원본 10MiB·4천만 화소 이하. 실제 시그니처/크기/애니메이션 여부를 검사하고 createImageBitmap → Canvas로 재인코딩해 EXIF 등 원본 메타데이터를 보존하지 않는다. 긴 변 1800px 이하·파일당 1.5MiB 이하, 고유 이미지 최대 100개/총 50MiB. 사진 설명은 140자, 보드당 사진 최대 100개다. 브라우저 실제 저장 한도는 더 작을 수 있으며 실패 시 이전 자료를 유지한다.
- 위치·크기·설명 변경은 Blob을 읽거나 다시 인코딩하지 않는다. Blob 조회는 표시/백업 때만 수행하고 Object URL은 컴포넌트 해제 시 revoke한다. 사진/도감 삭제 시 전체 남은 참조를 확인해 마지막 참조가 사라진 Blob·정보만 같은 트랜잭션에서 정리한다.
- 사진 보드 전체 백업은 .bokak v5 단일 바이너리 패키지다. BOKAKPK5\n + little-endian uint32 메타데이터 길이 + UTF-8 manifest + manifest 순서대로 원본이 아닌 최적화 Blob들을 이어 붙인다. ZIP/Base64/외부 라이브러리를 사용하지 않는다. manifest는 5MiB, 총 파일은 55MiB+13바이트 이하이며 데이터·사진 ID/소유자/용량/SHA256/실제 이미지 형식·크기/참조·누락·중복·추가 바이트를 검증한다.
- previewImport에서 모든 사진을 검증한 뒤 사용자 확인을 받고, 메타데이터·Blob·이미지 정보 전체를 하나의 readwrite 트랜잭션에서 교체한다. 미리보기 후 수정은 IMPORT_CONFLICT로 거부한다. 실패 시 이전 자료 전부를 보존한다. v1~v4 JSON 가져오기(5MiB 제한)는 유지하며, 이전 백업 전체 교체는 새 사진도 제거하므로 먼저 v5로 보존한다. 사진 없는 기록은 기존 JSON 버전을 유지한다. 사진을 모두 삭제한 보드도 version=3이면 빈 사진 목록의 v5로 보존한다.
- exportRecovery는 손상된 메타데이터와 사진 Blob을 빠뜨리지 않고 복구용 패키지로 내보낸다. 자동 가져오기용 정상 백업과 구별하며 별도 점검이 필요하다. 백업은 암호화되지 않으며 실제 사진/얼굴/개인 메모를 포함한다. 개인 파일을 Git·public·외부 API로 전송하지 않는다.

### 다중 인연 보드 (PHASE 6A)
- 인연 원본 CollectionEntry/Experience는 그대로 유지한다. 하나의 인연 Dex에 peopleBoards:{version:1,activeBoardId,boards:[{id,name,layout,view:{zoom}}]}를 저장한다. layout은 기존 배치·실·메모·사진 모델을 재사용한다. DB 버전 2와 Blob 스토어는 변경하지 않는다.
- 인연 화면 첫 진입의 managePeopleBoards(initialize)에서 기존 peopleBoard를 기본 보드로 이전하고 구형 필드를 제거한다. 실제로 여러 구형 보드가 있었으면 각각 보존하며 인연을 자동 분류·통합하지 않는다. 모든 변경은 같은 readwrite 트랜잭션에서 검증·저장하고 실패 시 원래 레코드와 사진 참조를 유지한다. 이미 peopleBoards가 있으면 재이전하지 않는다.
- layout.positions는 {placementId,entryId,x,y}. placementId는 board ID와 원본 Entry ID 쌍에서 결정적으로 생성해 동일 인연의 보드별 배치를 구분한다. 같은 보드 중복 배치는 무시하며 다른 보드의 좌표는 변경하지 않는다. 메모·사진·연결은 부모 board ID에 소속되고, 향후 객체 참조는 board ID + 객체 ID 조합을 사용한다. 6C의 자유 연결·다중 실·관계 라벨은 구현하지 않았다. 현재 실의 a/b는 같은 보드에 배치된 인연 Entry ID만 참조한다.
- managePeopleBoards는 생성·이름 수정·선택·삭제·배치·제거·확대를 담당하며 root Dex revision으로 충돌을 검출한다. 마지막 보드 삭제는 거부한다. 보드 삭제·배치 제거는 인연 원본/추억을 삭제하지 않는다. 원본 인연 삭제는 모든 보드 배치·관련 실을 함께 정리한다.
- 새 인연 등록은 원본/Experience/선택 보드 배치를 원자적으로 저장한다. 기존 인연을 다른 보드에 배치하는 작업은 collect를 호출하지 않는다. 보드 전환은 저장 중이거나 편집이 열려 있으면 차단한다. 새로고침 시 activeBoardId와 보드별 50/75/100% 확대를 복원한다. 스크롤 위치는 저장하지 않는다.
- 다중 보드 전체 백업은 .bokak v6(BOKAKPK6\n)이며 사진이 없어도 패키지로 내보낸다. v1~v4 JSON 및 v5 사진 패키지 가져오기는 유지하고, 구형 보드는 인연 화면에 진입할 때 안전하게 이전한다. 전체 보드의 사진 참조를 합쳐 이미지 해시/소유/용량을 검증하고 같은 트랜잭션으로 복원한다. 공유 Blob은 마지막 참조가 사라진 경우에만 제거한다. 기존 5MiB 메타데이터·50MiB 이미지 한도는 유지한다.
- 구버전 앱은 새 peopleBoards/v6를 읽지 못한다. 이전 버전으로 전환해 초기화하지 말고 업데이트된 앱과 전체 백업을 사용한다.

### 캐릭터 인연 (PHASE 6B)
- person subject에 선택 nickname(40자), trait(100자), tags(최대3개·각16자), avatar(classic/sprout/night/sun), profileAssetId를 추가한다. 이름·Entry ID·Experience·보드 배치 모델은 유지하며 입력을 자동 추론하지 않는다.
- collect(command, preparedImage?)와 updateEntry(..., patch, preparedImage?)는 검증·최적화된 사진을 인연 메타데이터와 같은 IndexedDB 트랜잭션에 저장한다. 기존 optimizePhoto/verifyPrepared 제한·메타데이터 제거를 그대로 사용한다. 저장 실패는 인연·Blob·참조 전체를 롤백하고 UI 입력을 유지한다.
- 프로필 사진은 전역 인연 원본에 속하며 모든 보드가 공유한다. photoReferences가 보드 사진+인연 프로필을 함께 추적하여 마지막 참조만 정리한다. 이동 시 이미지를 다시 저장하지 않는다.
- 캐릭터 필드가 있는 기록은 v7 .bokak(BOKAKPK7\n)로 내보낸다. 이미지 없는 캐릭터도 v7이며 기존 v1~v4 JSON, v5/v6 패키지는 계속 가져온다. DB_VERSION=2는 유지한다. 구버전 앱에서는 새 필드/v7을 읽을 수 없으므로 새 앱에서 사용한다.
- 발견 피드백은 기존 신규 저장 성공·requestId replay 제외 계약을 재사용한다. 수정·보드 배치·복원·화면 재진입은 새 발견을 만들지 않는다. 프로필 사진과 개인 메모는 브라우저 로컬 자료이며 백업도 민감정보를 포함한다.

### 자유 실 연결 (PHASE 6C)
- 보드 layout version=4: 기존 edges는 빈 배열, connections에 {id,boardId,from:{type,objectId},to:{type,objectId},style,label,createdAt}를 저장한다. type은 person(placementId), note(메모 ID), photo(보드 사진 ID). 원본 Entry ID와 배치/사진/메모 저장 구조는 유지한다.
- 인연 화면에서 managePeopleBoards(migrate-connections)가 기존 실을 deterministic legacy:[boardId,oldEdgeId] ID로 이전한다. 스타일과 좌표·사진·원본 정보는 보존하며 label은 빈 문자열, createdAt은 기존 root Dex 생성 시각을 사용한다(과거 실의 실제 생성 시각은 알 수 없음). 재실행은 불변이며 실패는 전체 트랜잭션을 롤백한다. 기존 참조가 손상된 경우 자동 초기화/삭제하지 않는다.
- connect-objects는 새 실마다 UUID를 생성한다. 같은 쌍도 별도 ID이면 여러 실을 허용하고, 같은 ID/같은 내용 재시도는 무시한다. 같은 ID의 다른 내용은 REQUEST_ID_CONFLICT다. 설명은 공백/빈 문자열 허용, 최대80자. 자기 연결·다른 보드·없는 객체 참조는 거부한다. 보드당 전체 실 10,000개 방어 한도이며 객체당 연결 제한은 없다.
- 메모/사진 삭제, 배치 제거, 원본 인연 삭제 시 해당 타입+객체 ID를 참조하는 실만 동일 트랜잭션에서 정리한다. 보드 삭제와 Blob 공유/정리 계약은 유지한다. 붉은 실 업적은 기존처럼 실제 인연↔인연 연결 기준이고 메모·사진으로 인연 업적을 추가하지 않는다.
- v4 layout이 있으면 .bokak v8(BOKAKPK8\n)로 내보낸다. v1~v4 JSON, v5~v7 패키지 가져오기 유지. 프로필/보드 Blob 해시·참조 검증 및 원자 복원은 그대로다. IndexedDB 물리 버전 2 유지. 구버전 앱은 새 연결/백업을 읽을 수 없으므로 업데이트된 앱에서 사용한다.
- 연결 모드의 클릭/터치와 객체 선택 메뉴는 동일한 선택 경로를 사용한다. 두 객체를 선택하면 현재 스타일과 빈 설명으로 즉시 저장한다. 설명 없는 실은 평소 선만 표시하며 실 선택 후 + 버튼으로 선택적으로 설명을 추가한다. 기존 설명은 라벨로 표시하고 다시 편집/제거할 수 있다. 저장 성공 전 보드에 실을 표시하지 않는다. 취소·실패 입력 보존·동일 ID 재시도를 지원한다. 저장된 실은 라벨 버튼이나 목록에서 편집/삭제한다.


### 인연 직접 기록 및 배치 (PHASE 6E-5)
- 표시 이름을 모든 카드의 기본 제목으로 사용한다. 기존 nickname/characterIntro/tags는 삭제하지 않으며 상세/부가 기록에서 확인·수정한다. 특징 추천 엔진과 추천 UI는 제거했고 신규 등록은 추천 없이 기존 collect 원자 저장과 최초 성공 발견 연출을 사용한다.
- person subject에 선택 age(0~150 정수, 자동 계산 없음), gender(male/female/other), mbti(16개 코드), energyType(egen/teto)를 추가한다. undefined는 미설정이다. 성별·MBTI·에겐/테토는 사용자가 직접 남긴 기록일 뿐 자동 분석·평가·추론하지 않는다. 기본 폼에 이름·나이·성별·입학연도·학과·관계를 표시한다.
- 새 선택 정보가 있는 백업은 v10 .bokak이다. 9바이트 magic BOKAKP10\\n + 기존 uint32 메타데이터 길이 + manifest + Blob 구조를 사용하여 13바이트 헤더 위치를 유지한다. 기존 v5~v9의 BOKAKPK5~9\\n 헤더와 v1~v4 JSON 가져오기는 그대로다. 물리 DB 버전2, 이미지 해시/소유/참조 검증 및 원자적 복원은 유지한다.
- 보드의 카드 배치 +는 월드 객체가 아닌 viewport 바깥 고정 조작 UI다. 앨범 모달에서 이름 검색 후 미배치 인연을 기존 managePeopleBoards(place)로 배치한다. 원본 인연·경험·발견·업적을 추가 생성하지 않는다. 이미 배치된 인연은 비활성화하며, 실패 시 모달과 오류 안내를 유지한다.
