import { readFileSync } from 'node:fs';
export interface MealSchedule {timeZone:'Asia/Seoul';times:string[];pollSeconds:number}
export function readMealSchedule(path:string,override=process.env.MEALS_SYNC_TIMES):MealSchedule{
  const value=JSON.parse(readFileSync(path,'utf8')) as MealSchedule;
  const times=override?override.split(',').map(s=>s.trim()):value.times;
  if(value.timeZone!=='Asia/Seoul'||!Array.isArray(times)||!times.length||times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||!Number.isInteger(value.pollSeconds)||value.pollSeconds<5||value.pollSeconds>60)throw Error('식단 스케줄 설정이 잘못되었습니다. KST HH:mm과 5~60초 확인 간격을 사용하세요.');
  return {...value,times:[...new Set(times)].sort()};
}
/** Latest due slot of this KST day; catches one missed slot when the worker resumes. */
export function dueMealSlot(now:Date,times:readonly string[]){
  const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const fields=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  const time=fields.hour+':'+fields.minute;
  const due=[...times].sort().filter(t=>t<=time).at(-1);
  return due?`${fields.year}-${fields.month}-${fields.day}T${due}+09:00`:null;
}
