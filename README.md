# BOKAK 2.0 — 나만의 대학도감

**대학생활의 모든 발견을 수집하다.**

직접 경험한 대학생활을 개인 도감에 모으는 서비스입니다. 공식 진입점은 `/` → `/dex`입니다. 이 README는 첫 팀 공유 브랜치 `bokak2/integration` 기준이며, main Merge는 별도 리뷰 후 진행합니다.

## 빠른 시작

검증 환경은 **Node.js 24.22.2 / npm 11.19.1**입니다. Next.js 16.4.6, React 19, TypeScript, Tailwind CSS 4를 사용합니다. Node 24 환경을 권장하며 `npm ci`로 lockfile의 버전을 설치하세요.

```powershell
git clone --branch bokak2/integration https://github.com/YitWub/Dancing-behind-the-professor-s-back.git BOKAK
cd BOKAK
npm ci
npm run dev
```

터미널의 Local 주소(보통 `http://localhost:3000`)를 엽니다. **package.json이 있는 BOKAK 폴더에서 실행**해야 합니다. 다른 서버가 3000번을 사용 중이면 터미널에 표시된 실제 포트를 확인하세요. `npm run dev -- --port 3001`로 지정할 수도 있습니다.

Windows에서 npm.ps1 실행이 차단되면 같은 명령을 `npm.cmd ci`, `npm.cmd run dev`로 실행합니다. Node/npm을 찾지 못하면 Node 설치 후 터미널과 VS Code를 다시 엽니다.

**기본 도감·학식 조회·수집·평가에는 API 키나 `.env.local`이 필요 없습니다.** `dev`, `build`, `start`, 일반 API GET은 크롤링을 실행하거나 학식 JSON·사진을 변경하지 않습니다.

## 현재 기능과 경로

| 경로 | 현재 상태 |
| --- | --- |
| `/dex` | 도감 홈, 최근 발견, 실제 달성 업적 전시, 백업 내보내기·가져오기 |
| `/dex/meal` | 날짜·식당·끼니별 확인된 식단 탐색, 직접 먹은 메뉴 수집 |
| `/dex/meal/collection` | 메뉴 도감 / 개별 카드 앨범, 검색·정렬·필터, 업적·개인 기록 |
| `/dex/meal/collection/[entryId]` | 경험별 카드 선택, 별점·한줄평 저장·수정, 경험·카드 삭제 |
| `/dex/people`, `/dex/custom` | 공통 엔진과 검증 계약은 존재하나 사용자 화면은 기본 골격. 완성된 CRUD 서비스가 아님 |
| `/dex/dev` | 개발자 허브. 디자인·컬렉션·에디션·출현 희귀도 미리보기와 별도 저장 실험실. **production에서 404** |
| `/legacy`, `/grade`, `/honey`, `/meal` | 기존 홈페이지·학점·꿀강·학식 기능 보존 |

한 식사 경험마다 카드 1장을 획득합니다. 같은 메뉴를 다시 먹으면 메뉴 종류는 유지되고 경험·카드가 추가됩니다. 에디션 확률은 NORMAL 60%, SPECIAL 27%, RARE 10%, GOLDEN 3%입니다. 카드 에디션은 음식의 제공 빈도와 별개입니다.

출현 빈도 희귀도는 아직 **UNKNOWN**입니다. 통계 기반 희귀·전설 업적은 준비 중이며 랜덤 카드 에디션으로 달성하지 않습니다. 로그인·서버 계정·기기 간 동기화·카드 거래는 구현하지 않았습니다.

## 개인 기록과 데이터 보존

- 도감·경험·카드는 브라우저 IndexedDB에 저장됩니다. 저장 성공 후에만 획득 연출을 실행하며 같은 requestId 재시도는 중복 지급하지 않습니다.
- 별점·한줄평은 각 Experience에 연결됩니다. 경험 삭제 시 해당 카드도 삭제되며, 수정으로 에디션을 다시 추첨하지 않습니다.
- 홈의 백업 기능을 사용하세요. v2로 내보내고 v1·v2를 가져올 수 있습니다. 기존 카드 없는 식사 기록은 NORMAL로 보존합니다.
- 브라우저 프로필·호스트·포트가 다르면 다른 저장 공간입니다. 로컬 저장은 인증된 비공개 서비스가 아니며 같은 프로필 사용자에게 보일 수 있습니다.
- 기존 학점 기록은 localStorage에 있으므로 **Git Clone이나 커밋으로 백업되지 않습니다.** 브라우저 기록과 개인 백업을 별도로 보존하세요. 개인 내보내기 파일을 저장소에 넣지 마세요.

## 학식 데이터: 새 Clone에서 가능한 범위

공용 메뉴와 개인 기록은 별개입니다. Git에는 `data/meals.json`, 사진 매핑 JSON, 음식 일러스트·업적 배지가 포함됩니다. 음식 그림은 실제 식판 사진이 아니라 대표 일러스트입니다. 추가 음식 12종과 새 업적 배지 9종도 `public/dex/`에서 함께 내려받습니다.

새 Clone은 **추적 중인 저장 식단의 날짜만 조회·수집**할 수 있습니다. 현재 날짜에 식단이 없으면 빈 화면 안내가 정상입니다. 날짜를 직접 바꿔 확인하며, 미래 식사는 등록할 수 없습니다. 실시간 정보인 것처럼 예전 메뉴를 보여주거나 빈 응답을 미운영일로 단정하지 않습니다.

다음 로컬 데이터는 Git에서 제외되며 Clone에 포함되지 않습니다.

| 경로 | 영향과 복구 방법 |
| --- | --- |
| `data/meal-sync/` | 최신 정상 스냅샷·동기화 시도·다운로드 식판 사진. 없으면 추적된 `data/meals.json`을 읽습니다. 일부 원본 사진은 없을 수 있으나 음식 그림과 개인 수집 기능은 동작합니다. 명시적 sync 성공 후 로컬에 생성됩니다. |
| `data/meal-observations/` | 날짜별 과거 공식 식단 관측 이력. 없으면 해당 과거 식단을 탐색할 수 없습니다. 통계 보고 JSON만으로 원본 식단이 복구되지는 않습니다. 공개 원문을 명시적으로 재수집할 수 있으나 서버 보관 범위에 따라 결과가 없을 수 있습니다. |

### 명시적 최신 식단 동기화

```powershell
npm run meals:sync
```

기본은 한국 시간 오늘·내일입니다. 특정 기준일은 `npm run meals:sync -- --date=2026-11-14`처럼 지정하며 필요하면 `--extra-date=YYYY-MM-DD`를 추가합니다. 학교 공식 사이트에 실제 남아 있는 메뉴만 수집합니다. **CLI 종료 코드 0만으로 성공을 판단하지 마세요.** 기존 계약상 수집 실패도 0으로 끝날 수 있으므로 출력의 `ok`, `/api/meals/status`의 수집 상태와 실제 제공 날짜를 확인합니다. 실패 시 마지막 정상 스냅샷은 보존합니다.

과거 관측이 꼭 필요할 때만 짧은 구간부터 실행합니다. 아래 명령은 실제 네트워크 요청과 로컬 관측 파일 생성을 수행합니다.

```powershell
node --experimental-strip-types scripts/observe-meal-history.ts --from=2026-09-01 --through=2026-09-03 --max-requests=4 --interval-ms=1800
```

실행 시 robots 정책을 확인하며 요청 횟수·간격을 제한합니다. 빈 날짜를 반복해서 대량 요청하지 마세요. 이 명령은 학생식당 대상이며, 최신 식단 JSON과 개인 기록을 변경하지 않습니다.

### 운영 자동화

자동 수집은 별도 `npm run meals:schedule` 작업자가 **실제로 실행 중인 환경**에서만 동작합니다. 기본 KST 07:00·11:00은 `config/meal-sync.json`에서 변경할 수 있습니다. `npm run meals:schedule -- --check`는 설정 점검만 하며 작업자를 설치하거나 시작하지 않습니다.

작업자는 영구 볼륨의 `MEALS_STORAGE_DIR`을 요구하며 Next 서버에도 같은 값을 전달해야 합니다. Vercel/Lambda 같은 비영구 파일 환경은 현재 어댑터로 지원하지 않습니다. 서버리스 스케줄러·영구 객체 저장소·서버 계정 동기화는 후속 작업입니다. Next 서버 실행만으로 정기 수집이 시작되지는 않습니다.

## 환경 변수: 전부 선택 사항

`.env.example`에는 비밀 값 없이 사용 가능한 옵션을 적었습니다. 필요한 경우에만 `.env.local`로 복사하고 각자 설정하세요. **스크립트용 환경 변수는 실행 셸 또는 작업자 서비스에도 전달해야 합니다.** Node로 직접 실행하는 수집 스크립트가 `.env.local`을 자동으로 읽는다고 가정하지 마세요.

| 변수 | 용도 |
| --- | --- |
| `GEMINI_API_KEY`, `GRADE_VISION_MODEL` | 기존 학점의 선택적 Gemini 이미지 재분석. 기본 브라우저 OCR·수동 입력에는 불필요 |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | 기존 `npm run score`의 선택적 LLM 강의 분석. 기본 도감 실행에는 불필요 |
| `MEALS_STORAGE_DIR` | 공용 식단의 영구 스냅샷·사진 저장 경로. 로컬 기본은 `data/meal-sync` |
| `MEALS_OBSERVATIONS_DIR` | 과거 식단 관측 경로. 로컬 기본은 `data/meal-observations` |
| `MEALS_SYNC_CONFIG`, `MEALS_SYNC_TIMES` | 별도 수집 작업자의 설정 파일 경로 / 쉼표로 구분한 KST 실행 시각 |

실제 키·토큰·개인 설정을 커밋하지 마세요. 기존 `.env.local`이 있다면 덮어쓰지 않습니다. Gemini 재분석을 누르는 경우에만 선택한 이미지가 외부 서비스로 전송됩니다. 공급자 모델 접근 권한과 과금은 각자 확인해야 하며 자동 설정되지 않습니다.

## 검증 명령

```powershell
npm ci
npm test
npx tsc --noEmit
npm run lint
npm run build
npm start
```

`npm start`는 빌드 후 production 서버를 실행합니다. production에서는 `/dex/dev`와 하위 도구가 404여야 합니다. 전체 ESLint가 실패하면 이번 변경 오류와 기존 학점·꿀강 영역 오류를 구분해 확인하세요. 통과하지 않은 검증은 PR에서 통과했다고 적지 않습니다.

## 첫 팀 공유 버전의 검증 상태

- 비밀 환경 변수·기존 node_modules·동기화/과거 관측 데이터가 없는 임시 Clone에서 `npm ci`, 전체 테스트 399개, TypeScript, production 빌드를 확인했습니다.
- 새 사용자 수집 → 카드 획득 → 앨범 → 경험별 평가 저장 → 새로고침 → 업적 흐름을 격리 브라우저에서 확인했습니다. 기존 학점·꿀강 경로도 응답하며 production 개발자 도구 6개 경로는 404입니다.
- BOKAK 2.0 범위 ESLint는 통과했습니다. **전체 ESLint는 기존 `HomeScreen.tsx` 1개, `HoneyScreen.tsx` 1개, `MealScreen.tsx` 4개 오류와 `scripts/sensitivity.ts` 경고 1개가 남아 실패합니다.** 무관한 기존 동작을 이번 공유 작업에서 재작성하지 않았습니다.
- Next.js를 16.4.6으로 보안 업데이트했습니다. 현재 `npm audit --omit=dev`는 0건이며 개발 도구 의존성 moderate 7건은 남아 있습니다. 강제 버전 변경으로 숨기지 않았으며 Merge 리뷰에서 검토해야 합니다.
- 빌드에는 동적 파일 경로 추적 경고 2개가 남아 있습니다. 파일 저장 어댑터의 실제 배포·용량·영구 볼륨 구성은 별도 운영 검토 대상입니다.

## 팀 협업

main Merge 전까지 팀원은 `origin/bokak2/integration`에서 개인 작업 브랜치를 만듭니다.

```powershell
git switch -c feat/people-dex
```

이미 Clone한 팀원은 먼저 `git status`를 확인하고, 작업을 보존한 뒤 `git fetch origin`, `git switch -c feat/people-dex origin/bokak2/integration`으로 시작합니다. 작업 중인 브랜치를 강제 초기화하지 마세요.

- A: `lib/dex/core`, `lib/dex/storage`와 통합. 스키마·requestId·백업 호환성 변경은 먼저 합의합니다.
- B: `lib/dex/meal`, `components/dex/meal`, `app/dex/meal` 및 공용 식단 파이프라인.
- C: 인연·자유도감의 실제 사용자 기능. 현재 골격과 공통 저장 계약부터 확인합니다.
- D: `components/dex/common`, `components/dex/discovery`, 디자인·연출. 음식 그림과 카드 에디션은 시각 표현이며 메뉴 ID를 바꾸지 않습니다.

위 범위는 협업 제안입니다. 기존 `CONTRACT.md`는 덮어쓰지 않았으며 새 소유권은 `docs/dex/CONTRACT_DRAFT.md`를 함께 검토해 합의하세요. 공용 layout·CSS·설정·홈 파일은 작업 담당자를 정하고 동시에 수정하지 않습니다. 기존 학점·꿀강 코드도 보존합니다.

현재 구현 기준은 코드와 [GAME_SYSTEM](docs/dex/GAME_SYSTEM.md), [MEAL_ID_POLICY](docs/dex/MEAL_ID_POLICY.md), [MEAL_AUTO_SYNC](docs/dex/MEAL_AUTO_SYNC.md)를 참고하세요. `ARCHITECTURE.md`·`MVP_SPEC.md`·`CONTRACT_DRAFT.md`에는 초기 설계 초안도 포함되므로 모든 예시가 현재 구현이라고 가정하지 마세요.

개별 변경을 검증해 커밋하고 PR로 공유합니다. 개인 IndexedDB 백업·`.env.local`·ZIP·스크린샷·관측 원문·다른 팀원의 미커밋 파일은 업로드하지 않습니다.
