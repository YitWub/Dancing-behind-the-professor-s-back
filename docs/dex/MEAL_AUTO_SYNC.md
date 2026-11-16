# 학식 수집·장기 아카이브 운영

이 문서는 공용 공식 식단의 로컬 파일 파이프라인 안내다. 개인 IndexedDB·카드 지급·업적 조건과 별개이며 메뉴 출현 희귀도는 **UNKNOWN**을 유지한다. 팀 공용 서버나 OS 예약 작업을 자동 설치하지 않는다.

## 최초 연결 / 새 Clone

Node 24 환경에서 저장소 루트에서 실행한다.

```powershell
npm ci
npm run meals:storage -- setup --directory=C:/Users/cla08/BOKAK-data
npm run meals:sync
npm run dev
```

다른 사용자는 자신의 홈 경로를 사용한다. setup은 프로젝트 외부만 허용하며 `.env.local`에 `MEALS_STORAGE_DIR`과 `MEALS_OBSERVATIONS_DIR`을 설정한다. 기존 다른 설정은 자동으로 바꾸지 않는다. 기존 프로젝트 내부 저장본은 **원본을 남기고** 복사하며 파일 크기·SHA256을 검증한다. 외부 저장소가 이미 초기화되어 있으면 재사용하고 오래된 내부 자료를 덮어 병합하지 않는다. 파일 충돌은 중단한다.

Next는 `.env.local`을 읽고, 식단 CLI도 Node의 환경 파일 로더로 같은 파일을 읽는다. 셸/서비스에 이미 설정한 환경 값이 우선이다. 설정 후 Next 서버를 재시작한다. Clone을 삭제해도 외부 폴더는 남지만 새 Clone에서 setup을 다시 실행해야 한다. 과거 폴더 삭제로 이미 사라진 자료가 자동 복원되는 것은 아니다.

## 명시적 수집과 공개 범위

```powershell
npm run meals:sync
npm run meals:sync -- --date=2026-11-16 --max-requests=24 --interval-ms=1800 --lookback-days=2
```

실행당 기본 최대 24회(robots 포함), 메뉴 페이지 간 최소 1.8초 간격이다. CLI 허용 범위는 요청 1~100회, 간격 최소 1500ms, 자동 보충 0~7일이다. 401·403·429는 해당 실행의 후속 요청을 중단하고 무한 재시도하지 않는다. robots가 404이면 파일 부재만 확인한 것이며 재배포 허가를 의미하지 않는다. 정책이 차단하거나 확인 불가능하면 수집하지 않는다.

순서는 기준일 4개 식당 → 내일 → 최근 누락 2일 → 기준일 페이지의 주간 메뉴에 실제 나타난 날짜다. 주간 메뉴는 날짜 후보로만 쓰고, 각 날짜·식당의 일별 원문을 검증한 뒤 보관한다. 최대 기준일+6일이며 빈 주간 날짜를 무작정 모두 요청하지 않는다. 예산을 넘긴 후보는 runs의 pending에 남는다.

기본 식당 ID는 1 학생식당(haksik), 2 교직원식당(faculty), 3 창업보육센터식당(changbo), 4 창의인재원식당(dorm)이다. 교직원·창보의 조식이 없다고 임의 휴무로 단정하지 않는다.

정상 과거 자료는 다시 요청하지 않는다. 미래 발표 자료는 제공일 이후 실제 관측이 한 번 더 필요하며, 미래 캐시 6시간·당일 캐시 15분 안의 정상 응답은 재사용한다. `--force`는 명시적 정정 확인이 필요할 때만 사용한다. 이미 보관한 주간 후보도 재사용하여 누락 미래 메뉴를 이어 수집한다.

구 CLI의 종료코드 계약을 보존하므로 `meals:sync`의 exit 0만으로 성공을 판단하지 않는다. 출력 `ok`·`error`, `<MEALS_STORAGE_DIR>/last-attempt.json`, 관측 runs를 확인한다. 정상 단위와 실패 단위가 섞이면 정상 단위만 게시하고 `partial`/오류 목록을 남긴다. 이미지 다운로드는 새 정기 파이프라인에서 기본 실행하지 않으며 공식 이미지 URL과 기존 파일은 보존한다. 메뉴 텍스트 확보를 우선하고 사진의 대규모 보관은 별도 정책으로 결정한다. 기존 사진 파서·다운로드 함수는 삭제하지 않았다.

## 저장·정정·통계

- meal-sync: 기존 배타 잠금·임시 검증·원자적 포인터 게시를 유지한다. v1 스냅샷은 계속 읽는다. 신규 디스크 v2는 날짜별 불변 JSON 파트의 해시를 참조하므로 바뀌지 않은 메뉴 전체를 매번 복제하지 않는다. 클라이언트에 넘기는 기존 CrawlResult 계약은 유지한다.
- meal-observations/days: 날짜×식당별 latest 시도와 effective 정상 자료, 불변 attempts를 저장한다. raw HTML은 SHA256으로 중복 제거한다. 수집 시각·원본 URL·메뉴 원문/구성/가격/열량·dishId·이미지 원본 URL·끼니별 증거를 보관하며 제공되지 않은 정보는 null이다.
- 완전 파싱된 끼니만 현재 메뉴를 교체한다. 정정 이전 메뉴·원문·사진은 이전 파트·시도에 남는다. 실패나 빈 응답으로 이전 정상 메뉴를 없애지 않는다. 부분 응답에서는 확인된 끼니만 갱신하고 다른 정상 끼니는 유지한다.
- 상태는 complete / partial / closed / empty-unknown / parse-error / network-error로 구분한다. 빈 메뉴는 미운영 증거가 아니다. 명시적인 휴무 문구가 있을 때만 closed다.
- catalog-index는 날짜 선택을 위한 작은 읽기 인덱스다. GET은 외부 수집·파일 쓰기를 하지 않는다. 오늘 이후에도 확인된 메뉴는 볼 수 있지만 미래 식사 저장·카드 지급은 기존 계약대로 거부한다.
- 통계는 식당과 비교할 끼니 범위를 명시한다. 선택한 모든 끼니가 정상/명시적 휴무로 확인된 **현재 또는 과거 날짜만** 분모에 포함한다. 미래 발표·누락·부분 파싱·실패는 정상 관측일로 만들지 않는다. 같은 메뉴가 여러 끼니에 나와도 날짜 1회다.

```powershell
node --experimental-strip-types scripts/report-meal-history.ts --cafeteria=faculty --meal-times=lunch,dinner --from=2026-11-01 --through=2026-11-16
```

학생식당 기본 비교 범위는 조식·중식이다. 다른 식당도 무조건 같은 운영 일정을 가정하지 말고 분석할 끼니를 정한다. 결과는 외부 관측 저장소 reports에 생성한다. 희귀도 등급은 이 결과만으로 활성화하지 않는다.

## 제한적 과거 복구

```powershell
node --experimental-strip-types scripts/observe-meal-history.ts --from=2026-11-13 --through=2026-11-14 --cafeterias=haksik,faculty,changbo,dorm --max-requests=9 --interval-ms=1800
```

최근 짧은 범위부터 확인한다. 이 명령은 명시한 날짜만 처리하고 정상 과거 자료는 건너뛴다. 사이트가 보관하지 않는 자료는 복원하지 못한다. 2026-11-16 조사에서 학생식당 9/1·11/13은 실제 응답했고, 현재 주간은 학생/교직원/창보 11/16~20, 기숙사는 11/15~21 메뉴가 보였다. 이것은 1년 전체 또는 모든 식당의 과거 보관을 보장하지 않는다.

## 자동 실행

```powershell
npm run meals:schedule -- --check
npm run meals:schedule
```

check는 설정 확인만 하며 프로세스 실행 여부를 조사하거나 작업자를 설치하지 않는다. 기본 KST 07:00·11:00이며 `config/meal-sync.json` 또는 `MEALS_SYNC_TIMES=08:00,12:00`으로 변경한다. 작업자는 실제 켜져 있는 동안만 실행하며 같은 슬롯 성공/실패를 재시작 직후 중복 요청하지 않는다. 잠금 충돌은 새 수집을 시작하지 않는다. PC가 꺼져 있거나 저장소·인터넷이 없으면 수집하지 못한다. 재실행 시 해당 KST 날짜의 가장 최근 슬롯 1개만 처리하고 최근 누락 날짜를 제한적으로 보충한다.

### Windows 작업 스케줄러 — 사용자가 직접 등록할 때만

아래는 **PC 시간대가 한국 표준시이고 현재 사용자로 로그인 중일 때**의 예시다. 다른 시간대에서는 시간을 변환하거나 상시 작업자의 KST 설정을 사용한다. 관리자/계정 정책으로 등록이 거부되면 임의 우회하거나 암호를 코드에 넣지 않는다.

```powershell
$repo = (Get-Location).Path
$node = (Get-Command node.exe).Source
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute $node -Argument ('--experimental-strip-types "' + $repo + '\scripts\schedule-meals.ts" --once') -WorkingDirectory $repo
$times = (Get-Content -Encoding utf8 config/meal-sync.json -Raw | ConvertFrom-Json).times
$triggers = @($times | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ })
$triggers += New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -Hidden
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'BOKAK-MealArchive' -Action $action -Trigger $triggers -Settings $settings -Principal $principal
```

사전에 `--check`로 실제 실행 시각을 확인한다. `MEALS_SYNC_TIMES`를 덮어썼다면 `$times`도 동일하게 바꾼다. 이 문서 작성 과정에서 OS 예약 작업을 등록하지 않았다. 로그오프 중 실행을 보장하지 않으며, Clone 경로나 Node 실행 파일 경로가 바뀌면 작업도 다시 등록한다. 외부 아카이브 자체는 남는다.

해제도 사용자가 직접 실행한다.

```powershell
Unregister-ScheduledTask -TaskName 'BOKAK-MealArchive' -Confirm
```

팀 공용 24시간 서비스에는 별도 호스팅 작업자·영구 볼륨/객체 저장소·공통 잠금·모니터링·백업이 필요하다. 현재 파일 어댑터는 Vercel/Lambda 임시 파일에 게시하지 않는다. 로컬 폴더 설정을 팀 전체 자동 동기화로 표현하지 않는다.

## 백업·복원

수집이 실행 중이면 잠금 확인 후 중단한다. backup은 새 폴더에만 복사하고 파일 목록·크기·SHA256 manifest를 검증한다. `.env.local`과 개인 IndexedDB 백업은 포함하지 않는다.

```powershell
npm run meals:storage -- backup --to=C:/Users/cla08/BOKAK-data-backups/manual-2026-11-16
npm run meals:storage -- verify --from=C:/Users/cla08/BOKAK-data-backups/manual-2026-11-16
npm run meals:storage -- restore --from=C:/Users/cla08/BOKAK-data-backups/manual-2026-11-16 --directory=C:/Users/cla08/BOKAK-data-restored
```

restore는 존재하지 않는 새 폴더에만 가능하며 기존 자료를 덮어쓰지 않는다. 새 Clone에서 setup의 `--directory`로 복원 폴더를 연결하고 Next를 재시작한다. 기존 env가 다른 경로를 가리킨다면 사용자가 경로를 확인한 뒤 두 MEALS 변수만 직접 수정해야 한다. 이전 폴더나 백업을 자동 삭제하지 않는다. PC 외부의 추가 백업도 필요하다.

## 대략적인 1년 용량

2026-11-16의 실제 보관 표본은 원문 31개 약 1.71MB(평균 약 55KB), 날짜별 관측/시도 JSON 58개 약 0.39MB, 날짜 파트 13개 약 47KB다. 기존 사진 6개는 약 0.72MB(평균 약 120KB)였으며 새 파이프라인은 사진을 추가 다운로드하지 않았다.

4개 식당·하루 2회 및 정정/미래·누락 보충 정도를 가정하면 메뉴/시도/파트/매니페스트 JSON은 약 30~80MB/년, HTML은 약 160~400MB/년을 계획할 수 있다. 주간 변동·빈 페이지 비중·시도 횟수에 따라 달라지는 추정치다. 사진을 하루 5~15개씩 별도 보관하면 표본 크기 기준 약 0.2~0.7GB/년이 추가된다. 백업 복사본 용량도 별도로 확보한다. 텍스트·증거를 우선 보존하며 기존 자료는 자동 삭제하지 않는다.
