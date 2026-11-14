import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHistoricalDay, failedHistoryDay, historyToMealObservations } from '../history.ts';
import { saveHistoryDay, readHistoryDay, listHistoryDays } from '../history-store.ts';
import { buildHistoryStatistics, reviewDayRarityCandidate, wilson95 } from '../history-statistics.ts';
import { robotsAllows } from '../history-policy.ts';
import { acquireMealLock } from '../sync-store.ts';
import type { HistoricalDay } from '../history.ts';
import type { HistoryDayFile } from '../history-store.ts';
const date='2026-09-01',time='2026-11-14T01:00:00Z';
function card(name:string,price=4500,menu='밥/김치'){return `<div class="menu-card-v"><div class="menu-card-v__name">${name}</div><div class="menu-card-v__desc">${menu}</div><span class="menu-card-v__price">${price}원</span></div>`;}
function group(meal:string,body:string){return `<div class="menu-group"><div class="menu-group__title"><span class="meal-badge--${meal}">${meal==='breakfast'?'조식':'중식'}</span></div>${body}</div>`;}
function page(body:string,day=date,facility='학생식당'){return `<div class="fac-name">${facility}</div><section><div id="view-pane-daily"><button class="week-day-pill is-selected" onclick="selectDay('${day}')"></button>${body}</div></section>`;}
const normal=()=>page(group('breakfast',card('[천원의 아침밥] 치즈돈까스'))+group('lunch',card('치즈돈가스 (Cheese Pork Cutlet)',6500)+card('돈까스&떡볶이')));
function file(day:HistoricalDay):HistoryDayFile{return {schemaVersion:1,latest:day,effective:day};}
const scope={from:date,through:date,cafeteria:'haksik' as const,mealTimes:['breakfast','lunch'] as ('breakfast'|'lunch')[]};
test('표본 일별 카드 수·선택 날짜·식당을 검증하고 같은 음식의 끼니 중복은 날짜 1회로 센다',async()=>{
  const day=await parseHistoricalDay(normal(),date,'haksik',1,time);assert.equal(day.status,'complete');assert.equal(day.meals[0].rawCardCount,1);assert.equal(day.meals[1].rawCardCount,2);
  const report=buildHistoryStatistics([file(day),file(day)],scope);assert.equal(report.validDates.length,1);assert.equal(report.totalMenuRecords,3);assert.equal(report.menus.length,2);assert.ok(report.menus.every(menu=>menu.appearanceDays===1&&menu.frequency===1));
  assert.equal((await parseHistoricalDay(normal(),'2026-09-02','haksik',1,time)).status,'parse-error');assert.equal((await parseHistoricalDay(normal(),date,'faculty',2,time)).status,'parse-error');
});
test('빈 이유 불명·부분 끼니·파싱 실패를 휴무나 미등장 분모로 만들지 않는다',async()=>{
  const empty=await parseHistoricalDay(page('선택하신 일자(2026-09-01)에 등록된 식단이 없습니다.')+'<p>주말 휴무</p>',date,'haksik',1,time);assert.equal(empty.status,'empty-unknown');
  const partial=await parseHistoricalDay(page(group('lunch',card('제육볶음'))),date,'haksik',1,time);assert.equal(partial.status,'partial');assert.equal(buildHistoryStatistics([file(partial)],scope).validDates.length,0);
  assert.equal(buildHistoryStatistics([file(partial)],{...scope,mealTimes:['lunch']}).validDates.length,1);
  const broken=await parseHistoricalDay(page(group('breakfast','<div class="menu-card-v"><div>알 수 없는 마크업</div></div>')),date,'haksik',1,time);assert.equal(broken.status,'parse-error');assert.equal(buildHistoryStatistics([file(empty)],scope).closedDates.length,0);
});
test('명시적인 해당 날짜 전체 미운영만 closed로 구분하며 전체 미운영일은 분모에서 뺀다',async()=>{
  const closed=await parseHistoricalDay(page('선택하신 일자(2026-09-01)는 휴무입니다.'),date,'haksik',1,time);assert.equal(closed.status,'closed');const report=buildHistoryStatistics([file(closed)],scope);assert.deepEqual(report.closedDates,[date]);assert.equal(report.validDates.length,0);assert.equal(report.missingDates.length,0);
});
test('가격·반찬·날짜 변경은 메뉴 ID를 바꾸지 않으며 일반/치즈·세트는 구분한다',async()=>{
  const first=await parseHistoricalDay(normal(),date,'haksik',1,time);const laterDate='2026-09-02';
  const next=await parseHistoricalDay(page(group('breakfast',card('치즈 돈가스',1000,'계란/국'))+group('lunch',card('돈가스')+card('돈까스&떡볶이')),laterDate),laterDate,'haksik',1,time);
  assert.equal(first.meals[0].items[0].dishId,next.meals[0].items[0].dishId);assert.notEqual(next.meals[0].items[0].dishId,next.meals[1].items[0].dishId);assert.notEqual(next.meals[1].items[0].dishId,next.meals[1].items[1].dishId);
  const report=buildHistoryStatistics([file(first),file(next)],{...scope,through:laterDate});assert.equal(report.menus.find(menu=>menu.dishId===first.meals[0].items[0].dishId)!.appearanceDays,2);
});
test('불명확한 영문 병기와 기존 ID 분리는 검토 대상으로 남기고 자동 병합하지 않는다',async()=>{
  const html=page(group('breakfast',card('밀양돼지국밥 Miryang Pork Soup'))+group('lunch',card('밀양돼지국밥 (Miryang Pork Soup)')));
  const day=await parseHistoricalDay(html,date,'haksik',1,time);assert.equal(day.status,'complete');assert.ok(day.meals[0].items[0].reviewFlags.includes('mixed-language-name'));assert.notEqual(day.meals[0].items[0].dishId,day.meals[1].items[0].dishId);
  const report=buildHistoryStatistics([file(day)],scope);assert.equal(report.identityReviews.length,1);assert.equal(report.menus.length,2);assert.equal(historyToMealObservations([day])[0].identitiesResolved,false);
});
test('다른 식당의 같은 메뉴는 해당 식당 분모·빈도에 섞이지 않는다',async()=>{
  const a=await parseHistoricalDay(normal(),date,'haksik',1,time);const b=await parseHistoricalDay(normal().replace('학생식당','교직원식당'),date,'faculty',2,time);
  const report=buildHistoryStatistics([file(a),file(b)],scope);assert.equal(report.validDates.length,1);assert.equal(report.totalMenuRecords,3);assert.ok(report.menus.every(menu=>menu.cafeteria==='haksik'));
});
test('재수집은 원문·시도 이력을 보존하고 날짜 집계는 늘리지 않으며 실패는 정상 이력을 유지한다',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bokak-history-test-'));try{
    const release=acquireMealLock(root)!;assert.ok(release);assert.equal(acquireMealLock(root),null);
    const html=normal(),day=await parseHistoricalDay(html,date,'haksik',1,time);saveHistoryDay(root,day,html);saveHistoryDay(root,day,html);assert.equal(readdirSync(join(root,'days','haksik',date,'attempts')).length,1);
    const later={...day,observedAt:'2026-11-14T02:00:00Z'};saveHistoryDay(root,later,html);assert.equal(readdirSync(join(root,'raw')).length,1);assert.equal(buildHistoryStatistics(listHistoryDays(root,'haksik',date,date),scope).validDates.length,1);
    const failure=failedHistoryDay(date,'haksik',day.source,'2026-11-14T03:00:00Z','network-error','timeout');saveHistoryDay(root,failure);const read=readHistoryDay(root,'haksik',date)!;assert.equal(read.latest.status,'network-error');assert.deepEqual(read.effective,later);assert.equal(buildHistoryStatistics([read],scope).validDates.length,1);assert.equal(buildHistoryStatistics([read],scope).latestProblems.length,1);assert.equal(readFileSync(join(root,'raw',day.htmlHash+'.html'),'utf8'),html);release();
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('실패만 있는 날짜·아예 관측하지 않은 날짜는 분모가 아니며 검토 등급은 항상 UNKNOWN이다',async()=>{
  const day=await parseHistoricalDay(normal(),date,'haksik',1,time),failed=failedHistoryDay('2026-09-02','haksik','https://life.hanyang.ac.kr',time,'parse-error','invalid');
  const report=buildHistoryStatistics([file(day),{schemaVersion:1,latest:failed,effective:null}],{...scope,through:'2026-09-03'});assert.equal(report.requestedDates,3);assert.equal(report.validDates.length,1);assert.equal(report.missingDates.length,2);
  const candidate=reviewDayRarityCandidate(report.menus[0],{version:'TEST-PROPOSAL',status:'proposal',metric:'restaurant-date',minimumDays:60,maximumFrequency:{LEGENDARY:.01,RARE:.04,UNCOMMON:.08}});assert.equal(candidate.tier,'UNKNOWN');assert.equal(candidate.eligibleForReview,false);assert.equal(candidate.requiresApproval,true);assert.ok(wilson95(1,50).upper>.05);
});
test('robots wildcard·구체적 봇 규칙·경로 우선순위를 적용한다',()=>{
  assert.equal(robotsAllows('User-agent: *\nDisallow: /','/theme/pages/facilities/detail.php'),false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\nAllow: /theme/pages/facilities/','/theme/pages/facilities/detail.php'),true);
  assert.equal(robotsAllows('User-agent: *\nAllow: /\nUser-agent: BOKAK-Meal-Research\nDisallow: /*?','/theme/pages/facilities/detail.php?id=1'),false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private$','/private-other'),true);
});
