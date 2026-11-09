# BOKAK

한양대 ERICA 학생의 수업·성적·강의·식사 선택을 돕는 캠퍼스 생활 앱입니다.

**입력은 적게, 결과는 풍부하게, 사용은 재미있게.**

| 메뉴 | 주요 기능 |
| --- | --- |
| 오늘 | 학점·강의·식사 정보를 모아 보는 홈. 일부 카드는 예시 데이터나 간단 진단을 사용합니다. |
| 학점 | 과목 관리, 시험·과제·출결 기록, HP, 상대평가 전망, 목표 학점 플래너, 강의계획서 이미지 입력 |
| 꿀강 | 강의 탐색과 강의평 기반 신뢰도·근거 확인 |
| 밥 | 학식 메뉴·사진·후기와 식사 선택 비교 |

Next.js 16 / React 19 / TypeScript / Tailwind CSS 4를 사용합니다. 학점 기록은 현재 브라우저에 자동 저장되며 계정 간 동기화가 아닙니다. 예상 학점은 입력 자료와 모델 가정에 따른 참고 결과입니다.

## 1. 준비물과 최신 코드 받기

Git, Node.js **24 LTS**(검증 환경), npm, VS Code를 준비합니다. Gemini 이미지 인식에는 팀원 각자의 Google 계정과 API 키가 필요합니다.

```powershell
node --version
npm --version
git --version
```

### 처음 내려받는 경우

원하는 상위 폴더에서 실행합니다. clone은 GitHub 코드를 새 폴더로 내려받습니다.

```powershell
git clone --branch main https://github.com/YitWub/Dancing-behind-the-professor-s-back.git
cd Dancing-behind-the-professor-s-back
```

### 이미 프로젝트가 있는 경우

먼저 상태를 확인합니다.

```powershell
git status
```

수정·추가 파일이 있거나 다른 작업 브랜치라면 아래 명령을 그대로 실행하지 말고 담당자와 보존 방법을 협의하세요. reset·clean으로 지우지 마세요. **작업 폴더가 깨끗하고 main을 업데이트하려는 경우에만** 실행합니다.

```powershell
git switch main
git pull --ff-only origin main
```

pull은 원격 변경을 받습니다. --ff-only는 자동 병합 커밋을 만들지 않으며 이력이 갈라지면 멈춥니다. 실패하면 강제로 맞추지 말고 팀에 문의하세요. 별도 worktree에서는 지정된 작업 브랜치를 유지하세요.

## 2. 의존성 설치

이후 모든 명령은 **package.json이 있는 프로젝트 루트**에서 실행합니다.

```powershell
npm ci
```

package-lock.json에 고정된 의존성을 설치합니다. clone·worktree마다 node_modules가 별도로 필요합니다. lockfile을 임의로 삭제하거나 npm install로 바꿔 맞추지 마세요.

## 3. Gemini API 키와 환경변수 설정

키 없이도 앱과 학점 수동 입력을 사용할 수 있습니다. 이미지 인식만 서버용 키가 필요합니다.

1. 각자 [Google AI Studio API Keys](https://aistudio.google.com/app/apikey)에 로그인합니다.
2. Create API key에서 프로젝트를 선택하거나 새로 만들어 키를 발급받습니다. [Google 공식 키 안내](https://ai.google.dev/gemini-api/docs/api-key)를 참고하세요.
3. 루트의 .env.example을 같은 위치의 **.env.local**로 복사합니다. 기존 파일이 있으면 덮어쓰지 말고 VS Code에서 필요한 항목만 추가합니다.

Windows PowerShell:

```powershell
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

macOS / Linux:

```bash
[ -e .env.local ] || cp .env.example .env.local
```

4. VS Code에서 .env.local을 열고 GEMINI_API_KEY의 등호 뒤에 자신의 키를 입력합니다. 아래 예시의 키는 의도적으로 비워 두었습니다.

```ini
GEMINI_API_KEY=
GRADE_VISION_MODEL=gemini-2.5-flash
```

파일은 app 폴더 안이 아니라 package.json 옆에 둡니다. .env.local.txt로 저장하지 마세요. worktree마다 환경변수 파일이 별도로 필요합니다.

예시 모델은 gemini-2.5-flash이며 계정의 접근 가능 여부를 보장하지 않습니다. 현재 서버의 허용 모델은 gemini-2.5-flash, gemini-2.5-flash-lite, gemini-3.5-flash-lite입니다. 기존 개발 과정에서 2.5 Flash의 404 사례가 있었으므로 모델 오류가 나면 AI Studio에서 접근 가능한 모델을 확인하고 허용 목록 안에서 설정하세요. 앱은 자동으로 모델을 바꾸지 않습니다.

**키를 GitHub 코드·이슈·PR·단톡방·스크린샷에 공개하지 마세요.** 각자 발급받아 사용하고 NEXT_PUBLIC_ 접두사를 붙이지 마세요. .env.example에는 빈 키만 공유하며 실제 .env.local은 Git에서 제외합니다. 노출된 키는 폐기하고 새로 발급받으세요.

이미지는 Google Gemini로 전송됩니다. 개인정보가 없는 평가비율 표만 잘라 사용하세요. 사용량·비용·데이터 처리 조건은 자신의 프로젝트와 [Google 요금 안내](https://ai.google.dev/gemini-api/docs/pricing), [요청 한도 안내](https://ai.google.dev/gemini-api/docs/rate-limits)에서 확인합니다. 무료 사용을 무제한으로 보장하지 않습니다.

## 4. 개발 서버 실행

```powershell
npx --no-install next dev
```

터미널에 표시된 Local 주소(보통 http://localhost:3000)를 브라우저로 엽니다. --no-install은 설치된 Next.js만 사용합니다.

**npm run dev는 predev로 학식 크롤러를 실행해 학식 데이터와 사진 DB 등을 변경할 수 있습니다.** 단순 기능 테스트에는 위 직접 실행 명령을 사용하세요. npm run build와 npm start도 각각 prebuild·prestart에서 크롤러를 실행합니다. 기존 npm scripts는 변경하지 않습니다.

환경변수를 수정했다면 서버 터미널에서 **Ctrl+C로 종료 → 같은 명령으로 재실행 → 브라우저 새로고침**합니다.

## 5. 학점 기능과 이미지 인식 테스트

1. /grade 또는 학점 메뉴에서 **+ 과목 추가**를 선택합니다. 기존 개인 과목 대신 테스트 과목을 권장합니다.
2. 과목명과 평가항목·비율을 입력합니다. 전체 비율은 100%로 맞춥니다.
3. 과목 추가/설정의 **평가비율 사진으로 입력 → 이미지 선택**에서 개인정보가 없는 강의계획서 표를 올립니다. PNG·JPEG·WebP, 3MB 이하를 지원합니다. 큰 이미지는 표만 잘라 사용하세요.
4. **인식 결과를 확인해 주세요**에서 이름·비율·합계와 확인 필요 항목을 대조합니다. **이대로 적용** 전에는 인식 결과가 과목에 반영되지 않습니다. 잘못 읽힌 값은 수정하거나 적용을 취소할 수 있습니다.
5. 설정 탭의 **출석 점수 항목 선택** 드롭다운으로 평가항목을 연결하고 총 수업 횟수를 설정합니다. 주차학습·학습참여도는 자동으로 출석으로 분류하지 않습니다. 연결 안 함이어도 출결 기록은 가능합니다.
6. 기록 탭에서 시험·과제 점수와 결석·지각을 입력하고 요약의 HP·성적 전망·목표 플래너를 확인합니다.
7. 새로고침 후 기록·설정이 유지되는지 확인합니다. 유효한 변경은 자동 저장됩니다. 브라우저·접속 주소·포트·프로필이 달라지면 기존 기록이 보이지 않을 수 있습니다.

HP는 100에서 시작하는 현재 최고 가능 총점입니다. 아직 치르지 않은 평가는 깎지 않습니다. 중간고사 80/100점·반영 30%는 HP 6 감소, 출석 10%·총 15회·결석 1회는 기본 규칙상 약 0.67 감소합니다. 결석을 정정하면 복원됩니다. 출석 차감은 앱 설정 규칙이며 교수자의 실제 기준과 같다고 단정하지 않습니다. HP가 높다고 상대평가 A+가 확정되는 것은 아닙니다.

키가 없으면 이미지 선택이 비활성화되고 **이미지 분석이 아직 준비되지 않았어요**가 표시됩니다. 수동 입력은 계속 가능합니다. 무료/사용량 한도 초과 시 기다리거나 수동 입력하도록 안내하며 기존 과목 데이터를 자동 삭제하지 않습니다.

## 6. 자주 발생하는 문제

| 증상 | 확인·해결 방법 |
| --- | --- |
| node/npm 명령을 찾지 못함 | Node.js 24 LTS 설치 후 터미널·VS Code를 다시 엽니다. npm.ps1 실행이 차단되면 npm.cmd ci를 사용합니다. |
| npm ci 실패 | 루트 폴더·Node 버전·네트워크를 확인합니다. package.json/lockfile 불일치는 담당자에게 문의하며 임의 수정하지 않습니다. |
| Next.js를 찾지 못함 | 해당 작업 폴더에서 npm ci를 먼저 실행합니다. |
| 이미지 분석이 아직 준비되지 않았어요 | 루트 .env.local의 두 변수, 빈 키·오타·확장자를 확인하고 서버를 재시작합니다. 준비 상태 확인은 실제 키 유효성·모델 권한 검증은 아닙니다. |
| Gemini API 키와 프로젝트 권한 오류 | 자신의 AI Studio 키와 프로젝트/API 제한을 확인합니다. 키 자체를 로그나 채팅으로 공유하지 않습니다. |
| 설정한 Gemini 모델을 사용할 수 없습니다 | 공급자 404에 해당합니다. 계정의 모델 접근 여부와 GRADE_VISION_MODEL을 확인하고 허용 모델로 설정 후 재시작합니다. |
| 무료/사용량 한도 또는 요청이 많다는 안내 | 공급자 429 또는 앱 제한입니다. 기다린 뒤 한 번 재시도하거나 수동 입력합니다. 서버 인스턴스당 분당 10회·동시 2회 제한이 있고 공급자 429 뒤 대기합니다. |
| 이미지가 크거나 읽지 못함 | 평가표만 선명하게 잘라 3MB 이하 지원 형식으로 저장합니다. PDF는 직접 지원하지 않으므로 표를 이미지로 캡처합니다. |
| 이미지 분석 실패·네트워크 오류 | 네트워크를 확인하고 잠시 후 재시도하거나 수동 입력합니다. 공급자 호출은 30초 제한이 있습니다. |
| 3000번 포트 사용 중 | 터미널이 안내한 포트를 쓰거나 npx --no-install next dev -p 3001로 실행합니다. 포트가 바뀌면 브라우저 저장 공간도 달라집니다. |
| 학식이 비어 있거나 오래된 메뉴 표시 | 저장 데이터·시드 날짜와 크롤링 상태에 따라 다릅니다. 갱신은 팀과 협의하고 테스트 목적으로 크롤러를 무작정 실행하지 않습니다. |
| 전체 ESLint 실패 | 기존 다른 영역 오류일 수 있습니다. 파일을 확인하고 학점 영역 검사와 구분하며 담당자 코드나 규칙을 임의로 바꾸지 않습니다. |

## 7. 데이터 변경 없이 검증하기

```powershell
npm test
npx --no-install next build
npx --no-install tsc --noEmit --incremental false
npx --no-install eslint lib/grade components/grade app/grade app/api/grade
```

Next 빌드를 먼저 실행하면 LayoutProps 등 생성 타입이 준비됩니다. 새 clone에서 tsc만 먼저 실행하면 생성 타입을 찾지 못할 수 있습니다. npm test의 크롤러 계약 테스트는 오프라인·임시 출력 경로를 사용합니다. 검증 후 git status로 데이터 변경 여부를 확인하세요.

## 팀 작업 규칙

변경 전 [AGENTS.md](AGENTS.md), [CONTRACT.md](CONTRACT.md), 학점 작업 시 [UX 설계 기준](lib/grade/UX_GUIDELINES.md)을 확인합니다. 루트 설정은 조율자 담당이며 .gitignore 같은 공통 설정은 협의합니다. README의 별도 담당자는 CONTRACT에 명시돼 있지 않습니다. UI·API·공통 타입 등은 해당 소유권 규칙을 따릅니다.

구현 세부 사항은 [학점 설계](lib/grade/README.md), [이미지 입력 안내](lib/grade/IMAGE_IMPORT.md)를 참고하세요. 이 예시의 기본 모델과 기존 이미지 문서의 개발 당시 모델은 다를 수 있으므로 실제 환경변수와 계정 접근 권한을 확인합니다.
