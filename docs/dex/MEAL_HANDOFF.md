# 학식도감 B·공통 UI D 인수 가이드

PHASE 3의 초기 수직 기능을 A가 구현했다. 이후 담당권 확정은 팀 CONTRACT 합의에 따르며 기존 CONTRACT/CONTRACT_DRAFT는 수정하지 않았다.

## 데이터 흐름

```text
기존 data/meals.json (읽기만)
→ 기존 GET /api/meals/status (PHASE 1, 읽기 전용)
→ readOfferings / adaptMealCatalog
→ resolveDish / ResolvedMealSelection
→ MealCollectionRequests (동작별 요청 고정)
→ 기존 repo.commitMealCollection = collectMeal 포트
→ 공통 IndexedDB transaction complete
→ Result / CollectionFeedback / 개인 목록 재조회
```

- 데이터·사진은 기존 경로를 읽는다. `components/data.ts`의 공용 후기/목록 기능과 결합하지 않았으며 새 크롤러·별도 식단 JSON·학식 전용 개인 DB는 없다.
- status 응답에는 전체 저장 식단이 있으므로 여기에서 날짜·식당·끼니로 필터링한다. 오류 시 mock 메뉴를 생성하지 않는다.
- 기본 날짜는 요청 시점 KST 오늘이다. 오늘 데이터가 없으면 빈 상태와 저장된 제공일 버튼을 보여준다. 가장 최근 저장일로 조용히 바꾸지 않는다.
- source·lastSuccessfulFetchAt·lastAttemptAt·오래됨·예시를 그대로 구분한다. 실제 오늘 메뉴인지 자동 검증했다는 표현을 추가하지 않는다.

## B가 수정할 파일

| 파일 | 책임 |
|---|---|
| lib/dex/meal/aliases.ts | 검토된 전체 이름 별칭, 고정 identityKey |
| identity.ts | v1 정규화·메뉴 ID. 변경 시 ID_POLICY와 이전 검토 필수 |
| catalog.ts | 기존 API 조회·읽기 전용 DTO 변환·수집 가능 출처/날짜 판단 |
| requests.ts | 동시 클릭·실패 재시도 요청 보존 |
| collection.ts | 경험 정렬·대표 별점·메모·사진 집계 |
| components/dex/meal/MealExplore.tsx | 실제 식단 탐색·수집 버튼 |
| MealCollection.tsx | 개인 수집 카드 목록 |
| MealEntryDetail.tsx | 개인 경험 편집/삭제·카드 삭제 |
| MealPhoto.tsx | 로컬 → 원본 이미지 → 아이콘 폴백 |
| app/dex/meal/** | 탐색·수집 목록·개인 카드 상세 진입점 |
| lib/dex/meal/__tests__/meal.test.ts | 식별/출처/실제 공통 저장 연결 테스트 |

## 수집 버튼과 요청 재시도

`MealExplore.record`가 명시적인 클릭에서만 `MealCollectionRequests.run`을 호출한다. 값은 `CollectMealCommand`이며 기본 별점 null, 메모 빈 문자열, 경험일은 선택한 원본 제공일이다. `getBrowserRepository().commitMealCollection`을 호출하고 저장이 확정된 Result만 사용한다.
같은 메뉴가 이미 있으면 실제 재방문인지 확인한 뒤 새 의도를 시작한다. 단순 재조회·식당 변경·날짜 변경은 저장하지 않는다.
run은 진행 중인 요청을 공유하고 빠른 반복 클릭에 짧은 재전송 방어를 둔다. 실패 요청은 원래 requestId와 내용을 메모리에 보존하고 `같은 요청으로 다시 시도`를 제공한다. 실제 재방문 확인 시에만 직전 성공 요청의 방어 상태를 해제하고 새 ID를 생성한다. 저장 결과가 불확실해도 같은 ID 재시도로 중복을 막는다.
새로고침 후에는 실제 저장 기록만 복원하고 실패 요청을 자동 실행하지 않는다. pending command는 현재 화면 메모리 수명이며 페이지를 닫으면 사라진다. 불확실한 요청을 임의로 새 ID로 바꾸거나 자동 재시도하지 않는다.

## 기록과 평가

별점/메모/먹은 날짜 편집은 공통 `updateExperience(ownerId,id,revision,patch)`다. 현재 폼은 500자 상한을 사용한다. 미평가와 0점은 다르며 미평가는 null이다. 공용 후기 POST를 호출하지 않는다.
삭제에는 각기 다른 확인 문구를 사용한다. `deleteExperience`는 해당 경험만, `deleteEntry`는 카드와 연결된 경험 전체를 지운다. 원본 제공일/context는 개인 경험일 편집과 별도로 보존한다.
대표값 정책은 [MEAL_ID_POLICY.md](./MEAL_ID_POLICY.md)를 따른다. 평균·공용 리뷰·수집하지 않은 메뉴를 자동 추가하지 않는다.

## D의 교체 지점

`components/dex/discovery/CollectionFeedback.tsx`는 엔진 Result+itemName+detailHref만 받는다. 신규/재방문/재전송/실패를 표시하고 저장하지 않는다. D가 NEW DISCOVERY 팝업·재방문 메시지로 교체할 수 있다. 복잡한 애니메이션, 캐릭터, 업적은 없다.
새로운 카드 판정은 UI의 수집 개수로 추정하지 말고 엔진의 outcome/replayed/discovery를 사용한다. 실패에 성공 연출을 실행하지 않는다. 현재 토스트는 aria-live와 닫기 버튼을 갖고 있고 모션이 없다. 이후 모달 도입 시 포커스 복원·키보드·모션 감소를 함께 검증한다.
공통 스타일은 기존 CSS 토큰/Card를 쓴다. 식단·기록 기능과 연출을 함께 다시 작성할 필요는 없다.

## 임의 변경하면 안 되는 공통 계약

- ownerId는 로컬 범위이며 서버 인증이 아니다.
- 카드 유일성은 owner+dex+dish, 요청 중복은 owner+requestId다.
- 카드/경험/영수증은 한 transaction이며 성공은 complete 이후다.
- 실패 재시도에서 requestId와 payload를 바꾸지 않는다.
- schemaVersion 1, import/export 검증과 receipt tombstone을 우회하지 않는다.
- persisted dishId를 이름/날짜/원본 순번으로 다시 계산하지 않는다.
- 공통 CRUD는 revision을 검사하며 다른 도감의 기록을 건드리지 않는다.
- core/storage, 루트 설정, 공유 UI/레이아웃 변경은 A/D와 합의한다. 기존 홈페이지·인연·자유도감은 이번 작업에서 수정하지 않았다.

## 이어서 검증하기

통합 워크트리에서 `npm.cmd run dev` 후 표시된 주소의 `/dex/meal`로 접속한다. 같은 워크트리 서버가 이미 있으면 그 서버를 사용한다. 기존 학점 작업 폴더에는 새 경로가 없다.
현재 저장본은 2026-11-04~05다. 저장된 날짜를 선택해 먹은 메뉴를 명시적으로 등록하고, 목록/상세에서 선택 평가를 남기고 재방문·새로고침·삭제를 검증한다. 실제 오늘 식단을 만들기 위해 크롤러를 실행하지 않는다.
개발용 `/dex/dev`는 PHASE 2의 별도 검증 DB이며 실제 학식 개인 기록과 섞지 않는다. 테스트용 사용자 프로필/브라우저 컨텍스트를 사용한다.
수동 검증과 별도로 `npm.cmd test`, TypeScript, 관련 ESLint, build를 실행한다. 실제 학교 사이트를 긁는 테스트를 추가하지 않는다.
