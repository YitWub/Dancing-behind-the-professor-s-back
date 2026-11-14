# BOKAK 2.0 병렬 개발 계약 초안

상태: 팀 검토 전 / PHASE 0 / 2026-11-12 KST. 이 문서는 기존 CONTRACT.md를 교체하거나 기존 코드 소유권을 자동 변경하지 않는다. 신규 영역의 계약을 합의한 뒤 기존 영역 변경의 담당 이전을 명시한다.

## 역할·배타적 파일 소유권

| 담당 | 소유 경로 | 산출·타인에게 제공할 계약 |
|---|---|---|
| A 공통 엔진/저장/통합 | lib/dex/core/**, lib/dex/storage/** | Dex/Entry/Experience, repository, 원자 수집·revision·export/import |
| B 학식 | lib/dex/meal/**, components/dex/meal/**, app/dex/meal/**, app/api/dex/meals/** | Dish/Alias/Offering, readOfferings, resolved selection |
| C 인연/자유 | lib/dex/people/**, lib/dex/custom/**, components/dex/people/**, components/dex/custom/**, app/dex/people/**, app/dex/custom/** | CRUD·입력 검증·인연 메시지 조건 |
| D 공통 UI/UX | components/dex/common/**, components/dex/discovery/**, 새 components/ui/** | 카드/폼/빈 상태·오류 상태·발견 연출·접근성 |

기존 lib/meal/**, scripts/crawl-meals.ts, app/api/meals/**, data/dex/meal-aliases.json의 향후 변경 담당은 B로 제안한다. 기존 담당과 인수 범위를 확인한 뒤 시작한다. PHASE 0에서는 이 경로들을 수정하지 않는다. 크롤러의 식단·사진 산출물을 여러 명이 동시에 갱신하지 않는다.

## 공유 파일 단일 작성자

| 파일/영역 | 최종 작성자 | 협의 방식 |
|---|---|---|
| app/page.tsx, app/layout.tsx, app/globals.css | A | D가 UI와 토큰 변경안을 전달, A가 연결 |
| components/AppShell.tsx, components/TabBar.tsx, components/theme.css | D | A는 props·배치·탐색 경로 요청만 전달 |
| 기존 components/ui.tsx, format.ts, charts.tsx | D | 도메인 전이 의존성 확인 후 분리, 기존 기능 삭제와 묶지 않음 |
| 기존 components/data.ts, mock.ts | A | B/D와 read-only 공급·fixture 분리 협의 |
| lib/types.ts, lib/datetime.ts | A | 기존 타입 파괴 금지, 신규 타입은 lib/dex로 분산 |
| package.json, package-lock.json, tsconfig, next/eslint 설정 | A | 새 의존성·스크립트를 단일 변경으로 반영 |
| instrumentation.ts | A | B와 자동 수집 제거 경계 검토 |
| docs/dex/MVP_SPEC.md, ARCHITECTURE.md, CONTRACT_DRAFT.md | A | B/C/D 제안 수집 후 계약 버전 갱신 |
| 기존 CONTRACT.md, AGENTS.md | 기존 책임자/A 조율 | 명시적 합의 없이 교체 금지 |
| 기존 grade/honey/backtest 및 해당 데이터 | 기존 담당 | 보존; 신규 작업에서 임의 수정 금지 |

공유 파일 작업은 파일명·목적·시작/종료·영향 인터페이스를 팀 작업 보드에 예약한다. 예약 중 다른 담당자는 같은 파일을 편집하지 않는다. 예상 충돌은 먼저 diff로 조율하고 자동으로 덮어쓰지 않는다. 공통 타입 breaking change는 소비자 B/C/D가 확인한 뒤 A가 반영한다. 초기 인터페이스 버전 v0.1은 문서에 고정하며 확정 전 구현을 완료로 간주하지 않는다.

## 경계 규칙

- core에는 순수 검증·유스케이스·저장 포트만 둔다. IndexedDB는 storage, 원본 식단 읽기·정규화는 meal, UI는 components다.
- B/C는 상대 기능의 내부 구현을 import하지 않는다. A의 공개 계약 또는 합의한 DTO만 사용한다.
- D의 UI는 DB·크롤러·API를 직접 호출하지 않고 값/콜백을 받는다. 저장 확정 결과만 연출한다.
- 서버 fs·크롤러·API 키는 클라이언트 그래프에 넣지 않는다. 신규 IndexedDB 모듈은 SSR 시 접근하지 않는다.
- 인연·개인 경험·내보내기 파일을 public, 추적 JSON, console, 분석 서비스에 보내지 않는다. ownerId를 인증으로 간주하지 않는다.
- 오류를 mock 저장 성공으로 숨기지 않는다. seed/mock는 실제 수집과 분리한다.
- source 식단, persistent Dish, private Entry, actual Experience를 혼용하지 않는다. 임의 수집 완료율·사람 가치 등급은 만들지 않는다.
- 삭제 후보는 검색·동적 참조·공유 import·테스트·복구 상태를 검토한 별도 작업으로만 정리한다.

## 첫 수직 기능의 A/B/D 인수인계

| 순서 | 제공 → 소비 | 데이터/책임 |
|---|---|---|
| 1 | B → B UI | readOfferings(date, cafeteria?, mealTime?) → 원문·출처·resolved/unresolved Offering |
| 2 | B → A | ResolvedMealSelection + ownerId/dexId/requestId + 경험일·별점·메모 |
| 3 | A → B | collectMeal 결과: entry, experience, outcome, replayed, committedAt, discovery |
| 4 | B → D | 성공 + discovery != null + replayed=false인 경우에만 연출 이벤트 전달 |
| 5 | A → B/D | 목록·경험 조회 결과, 새로고침 이후 동일 데이터 |

정확한 TypeScript 시그니처는 ARCHITECTURE.md의 A/B/D 인터페이스가 단일 초안이다. B는 자체 카드 중복 판정을 만들지 않고 A는 식단 이름에서 dishId를 추정하지 않는다. D는 신규 여부를 방문 횟수나 UI 상태로 추측하지 않는다.

## 브랜치·워크트리와 보존

- bokak2/integration은 원격 main을 확인한 커밋에서 시작한다. 기존 feat/grade-engine, feat/grade-improvements, docs/setup-guide 워크트리와 stash를 유지한다.
- 후속 A/B/C/D는 각각 bokak2/core, bokak2/meal, bokak2/people-custom, bokak2/ui와 독립 워크트리를 권장한다. PHASE 0에서는 통합 워크트리만 만든다.
- 통합 문서는 미커밋 상태이므로 지금 새 브랜치를 만들면 자동 전달되지 않는다. 팀 검토 후 별도로 승인된 커밋 단계가 있어야 팀원이 같은 계약을 받는다. 이번 단계에는 Commit/Push/PR/Merge가 없다.
- 기존 미커밋 GPA·시나리오·공개 통계 코드와 두 작업 폴더의 서로 다른 학식 데이터는 새 브랜치에 자동 적용하지 않는다. 필요한 자산은 목록과 출처를 확인해 후속 작업에서 선택한다.
- 백업은 Git bundle + 작업 폴더별 원래 경로 파일 + diff + SHA-256 manifest로 구성한다. 환경변수는 보호된 외부 로컬 백업만 허용하고 Git에 추가하지 않는다.
- node_modules/.next/tsbuildinfo는 재생성 대상으로 제외 기록한다. 브라우저 localStorage/IndexedDB는 Git 백업 밖이며 사용자가 별도 내보낸다.

## 개발 환경·작업 순서

PHASE 0에서는 문서만 작성하고 Node 설치·의존성 설치·서버·빌드·데이터 스크립트 실행을 하지 않는다. 현재 셸은 node/npm을 찾지 못한다. 일반 설치 경로 및 Node.js 레지스트리 경로에서도 확인되지 않았다. 시스템 전체에 설치가 없다는 단정은 하지 않는다.
후속 환경 준비: 사용자의 실제 Node 설치 위치를 확인하거나 프로젝트 README 기준 Node 24 LTS 설치, 해당 디렉터리를 사용자 PATH에 등록하고 터미널을 다시 연다. node --version, npm --version, Get-Command node,npm으로 확인한다. npm.ps1 실행 정책 문제는 npm.cmd로 구분해 진단한다. 새 worktree는 node_modules와 .env.local을 상속하지 않는다.
자동 크롤링은 lifecycle, instrumentation, API GET 세 경로를 모두 처리해야 한다. 상세 계획은 ARCHITECTURE.md를 따른다. 안전 패치 전 npm dev/build/start와 데이터 생성 스크립트를 실행하지 않는다. npm ci도 lifecycle·의존성 설치 스크립트 실행 여부를 검토한 후 별도 단계에서 수행한다.

후속 순서:

1. A/B/C/D가 모델·소유권·미결정을 확인한다.
2. Node/npm을 검증하고 A/B가 새 워크트리의 자동 수집 경로를 제거하는 작은 패치를 진행한다.
3. 변경 없는 조회를 해시·임시 경로·mock 네트워크로 검증한다.
4. A는 저장/중복/재방문 계약, B는 read-only 식단과 안정 메뉴 매핑, D는 최소 선택·연출 UI를 구현한다.
5. MVP_SPEC의 첫 완료 기준과 export/import 보존 경로를 검증한다.
6. C는 확정된 core 계약 위에서 인연/자유를 구현한다. 홈·탭 교체는 그 이후 별도 범위다.

이번 PHASE 0의 완료 기준은 원본 보존 검증, 새 통합 워크트리, 세 문서 초안이다. 실제 기능·빌드·브라우저 테스트 통과를 완료 조건으로 오인하지 않는다.
