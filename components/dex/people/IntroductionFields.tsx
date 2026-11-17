'use client';
import {useState} from 'react';
import {suggestIntroductions} from '@/lib/dex/people/introductions';
import type {IntroductionSuggestions} from '@/lib/dex/people/introductions';
import type {PersonSubject} from './PeopleForms';
export function IntroductionFields({value,onChange}:{value:PersonSubject;onChange:(value:PersonSubject)=>void}){
 const [suggestions,setSuggestions]=useState<IntroductionSuggestions|null>(null),[source,setSource]=useState(''),[index,setIndex]=useState(0),[manual,setManual]=useState(false);
 function choose(i:number,result=suggestions){if(!result)return;setIndex(i);const c=result.candidates[i];onChange({...value,nickname:c.nickname,characterIntro:c.intro});}
 function recommend(){if((value.nickname||value.characterIntro)&&!window.confirm('현재 별명과 소개 대신 새 추천을 받을까요? 저장하기 전에는 기존 기록이 바뀌지 않아요.'))return;const result=suggestIntroductions(value.trait??'');setSuggestions(result);setSource(value.trait??'');choose(0,result);}
 const edited=!!value.nickname||value.characterIntro!==undefined||manual;
 return <section className="people-introduction" aria-label="캐릭터 소개 추천"><div className="people-actions"><button type="button" disabled={!value.trait?.trim()} onClick={recommend}>발견 멘트 추천</button>{suggestions?<button type="button" onClick={()=>choose((index+1)%suggestions.candidates.length)}>다른 소개 받기</button>:null}{!edited?<button type="button" onClick={()=>setManual(true)}>직접 소개 쓰기</button>:null}</div><p className="people-privacy">브라우저 안의 단서 규칙으로 제안해요. 모든 문장을 이해하지는 못하며, 아바타나 성격을 자동 결정하지 않아요.</p>
 {suggestions?<><p role="status">{suggestions.fallback?'뚜렷한 단서가 없어 기본 소개를 제안했어요. 직접 바꿔 주세요.':'마음에 드는 소개를 고르거나 아래에서 직접 고쳐 주세요.'}{source!==value.trait?' 기억나는 점이 바뀌었어요. 필요하면 추천 버튼을 다시 눌러 주세요.':''}</p><div className="people-intro-candidates">{suggestions.candidates.map((c,i)=><button key={c.nickname} type="button" aria-pressed={value.nickname===c.nickname&&value.characterIntro===c.intro} onClick={()=>choose(i)}><strong>{c.nickname}</strong><span>{c.intro}</span></button>)}</div></>:null}
 {edited?<div className="people-intro-edit"><label>캐릭터 별명 <small>직접 수정 가능 · 40자</small><input maxLength={40} value={value.nickname??''} onChange={e=>onChange({...value,nickname:e.target.value})}/></label><label>발견 소개 <small>직접 수정 가능 · 300자</small><textarea rows={3} maxLength={300} value={value.characterIntro??''} onChange={e=>onChange({...value,characterIntro:e.target.value})}/></label></div>:null}</section>;
}
