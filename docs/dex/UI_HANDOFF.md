# PHASE 4 UI 인수인계

기존 CONTRACT.md는 변경하지 않았다. 아래는 신규 dex 파일의 임시 관리안이며 팀 합의로 확정할 대상이다. 이번 변경은 사용자가 요청한 통합 UI 작업 범위에 한정한다.

## 파일 담당

| 담당 | 파일·범위 | 책임 |
|---|---|---|
| A | lib/dex/core/**, lib/dex/storage/** | 원자 저장, requestId, revision, backup, 모델. 이번 단계 변경 없음 |
| A 임시 통합 → D와 조율 | app/dex/layout.tsx, components/dex/scaffold/DexScaffold.tsx | 도감 공통 배치, 실제 집계·최근 기록·백업 연결 |
| B | app/dex/meal/**, components/dex/meal/**, lib/dex/meal/** | 나의 도감/탐색 연결, 식단 선택, 저장 호출, 목록·상세·경험 편집 |
| C | app/dex/people/**, app/dex/custom/** 및 대응 도메인 | 현재 골격 유지, 실제 CRUD는 다음 단계. 신규 개인 정보 공개 금지 |
| D | components/dex/common/CollectionCard.tsx, CollectionArtwork.tsx, DexNavigation.tsx | 카드·빈 상태·아트·공통 탐색 |
| D | components/dex/discovery/CollectionFeedback.tsx, app/dex/dex.css | 저장 결과 연출, 모달 접근성, 도감 전용 토큰·반응형 |
| A 작성 → B/C/D 검토 | docs/dex/PHASE4_REPORT.md, DESIGN_SYSTEM.md, UI_HANDOFF.md | 구현 결과와 합의할 인수 범위 |

기존 계약에서 components/**는 기존 팀원3 영역이다. 위 D/B/C 배정은 담당 이전 제안이지 기존 계약을 일방적으로 확정한 것이 아니다. 기존 theme.css/AppShell/TabBar, app/page.tsx, 루트 설정은 이번에 건드리지 않았다. 공유 파일은 작업 보드에 파일명·시작/종료·변경 목적을 예약하고 단일 작성자가 반영한다. B/C는 D 공통 CSS를 직접 동시에 편집하지 않고 필요한 상태와 props를 전달한다.

## 데이터 흐름

```text
GET /api/meals/status → readOfferings → CatalogOffering.selection
  → 기존 MealCollectionRequests.run (requestId 유지)
  → 기존 repository.commitMealCollection → 트랜잭션 완료 Result
  → listExperiences(실제 횟수 조회) + CollectionFeedback(result)
  → 기존 useDexDocument.reload / 변경 구독
  → mealCards(document) → CollectionCard → 기존 상세 경로
```

아트와 CSS는 저장소를 import하지 않는다. MealCollectionPanel은 개인 document를 props로 받고, 알려진 메뉴 예고용 공용 식단만 읽는다. 미수집 표시를 위해 새로운 개인 레코드나 공용 JSON을 쓰지 않는다. 최초 수집 성공 여부는 화면의 기존 카드 개수로 추정하지 않는다.

## 사용 인터페이스

```tsx
<CollectionCard title="표시 이름" artwork={<CollectionArtwork kind="custom" />} meta="2026-11-04 · 나의 메모" />
<CollectionArtwork kind="people">{/* 같은 프레임에 넣을 전용 SVG */}</CollectionArtwork>
<CollectionFeedback result={committedResult} itemName={displayName}
  title="새로운 인연 발견!" artwork={<CollectionArtwork kind="people" />}
  detailHref={actualDetailHref} onDismiss={dismiss} />
```

인연 메시지 예시는 등록 조건에 근거해 C가 선택한다. 사람의 가치·등급·별점을 추가하지 않는다. 자유도감도 같은 카드에 제목·수집일·메모만 전달하면 된다. 음식용 visitCount, rating은 공통 카드의 필수 props가 아니다. visitCount는 실제 경험 개수이며 다른 도메인에 필요 없으면 넘기지 않는다. 인연·자유 CRUD 및 상세 경로가 실제 구현되기 전에는 가짜 링크나 샘플 기록을 만들지 않는다.

`/dex/meal/collection`은 유지되며 MealCollectionPanel을 재사용한다. `/dex/meal/collection/[entryId]`의 경험 편집·삭제·카드 삭제·대표 별점 정책은 그대로다. `/dex/meal?view=discover`는 탐색 직접 진입, 기본 `/dex/meal`은 컬렉션이다. 원래 `/` 및 `/meal`, `/grade`, `/honey`는 유지한다.

## 팀원에게 넘길 다음 작업

- B: 날짜별 식단 탐색의 실제 사용성, 명시적 수집 담당 운영, 검토된 dishId별 전용 아트 제공. 자동 크롤링을 복구하지 않는다.
- C: core/storage 공개 포트로 인연·자유 CRUD를 연결하고 공통 카드·발견 UI를 재사용한다. 인연 개인정보를 공용 API/JSON에 기록하지 않는다.
- D: 학생 피드백 기반 타이포·카드 크기·전용 SVG·모바일 다듬기, 스크린리더 실기 점검. 실제 저장 결과 조건을 유지한다.
- A: 공통 저장·통합 회귀와 소유권 조정. PHASE 4를 위해 DB 버전이나 모델을 변경할 필요는 없었다.

## 검증과 반복 방법

먼저 npm test, npx tsc --noEmit, npx eslint app/dex components/dex, npm run build. 자동 크롤러를 호출하는 명령은 실행하지 않는다. 브라우저는 새 Chrome 컨텍스트를 사용한다. 기존 사용자의 IndexedDB를 삭제하거나 테스트 데이터로 대체하지 않는다.

`verification/phase4-browser.mjs`는 Playwright가 별도로 설치된 도구 환경에서 실행한다. 제품 package.json에는 의존성을 추가하지 않았다. `BOKAK_PLAYWRIGHT_MODULE`에 Playwright ESM URL, `BOKAK_TEST_BASE`에 실행 중인 integration URL, `BOKAK_ARTIFACT_DIR`에 저장소 외부 결과 폴더를 지정한다. 저장본에 있는 실제 2026-11-04 들기름막국수로 검사하므로 원본 데이터가 바뀌면 fixture 선택도 검토한다. 테스트는 격리 컨텍스트에서만 트랜잭션 중단을 주입하며 종료 시 해당 컨텍스트를 닫는다.

`verification/phase4-ui-gates.mjs`는 현재 컴포넌트를 임시 모듈로 컴파일하여 null/최초 성공/재전송/재방문/실패/discovery 없음의 6개 표시 계약을 검사한다. 엔진 재전송 테스트는 기존 npm test에 남아 있다. Chrome 스크린샷은 테스트 기록만 포함하며 사용자 개인 기록이 아니다.
