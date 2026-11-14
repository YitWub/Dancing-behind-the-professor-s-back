import { generateCollectionPreview, DEFAULT_WEIGHTS } from './collection-fixtures.ts';
import type { CardEdition } from '../meal/card-editions.ts';
export type DesignKind='meal'|'people'|'course';
export interface DesignSample {id:string;kind:DesignKind;title:string;meta:string;stamp:string;note:string;edition?:CardEdition}
export const DESIGN_LABELS:Record<DesignKind,string>={meal:'학식도감',people:'인연도감',course:'강의도감'};
const PEOPLE=['도서관 친구','햇살','과방 짝꿍','동아리 메이트','산책 친구','발표 파트너','모카','밤샘 동지'];
const COURSES=['자료구조','프로그래밍 기초','사진과 예술','대학 글쓰기','캠퍼스와 환경','데이터로 보는 세상','디자인의 이해','미디어와 사회'];
/** Memory-only design samples. People and courses never receive meal card editions. */
export function createDesignSamples(kind:DesignKind,count:number,edition?:CardEdition):DesignSample[]{
  if(![5,30,100].includes(count))throw Error('디자인 샘플은 5·30·100개를 지원합니다.');
  if(kind==='meal')return generateCollectionPreview({count,uniqueMenus:Math.min(count,10),seed:'BOKAK-DESIGN-46A',weights:{...DEFAULT_WEIGHTS}}).map(item=>({id:'design-'+item.card.id,kind,title:item.name,meta:item.experiencedOn,stamp:'한 끼의 발견',note:'바삭한 첫입, 점심시간의 작은 행복.',edition:edition??item.card.edition}));
  return Array.from({length:count},(_,i)=>kind==='people'?{id:'design-person-'+i,kind,title:PEOPLE[i%PEOPLE.length],meta:['동아리에서','도서관에서','과방에서'][i%3],stamp:['함께한 첫 프로젝트','같이 걷는 사이','반가운 만남'][i%3],note:'같이 웃으며 캠퍼스를 걷던 오후를 기억해요.'}:{id:'design-course-'+i,kind,title:COURSES[i%COURSES.length],meta:i%2?'2026년 1학기':'2026년 2학기',stamp:'나의 수업 기록',note:'작은 질문이 새로운 관심으로 이어진 수업.'});
}
