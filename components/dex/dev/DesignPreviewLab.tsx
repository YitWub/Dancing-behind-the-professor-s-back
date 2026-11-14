'use client';
import Link from 'next/link';
import { useState } from 'react';
import { CARD_EDITIONS } from '@/lib/dex/meal/card-editions';
import type { CardEdition } from '@/lib/dex/meal/card-editions';
import { createDesignSamples, DESIGN_LABELS } from '@/lib/dex/dev/design-samples';
import type { DesignKind, DesignSample } from '@/lib/dex/dev/design-samples';
import { DesignPreviewCard } from '@/components/dex/common/DesignPreviewCard';
import './DesignPreviewLab.css';

function RecordPreview({sample,reviewed}:{sample:DesignSample;reviewed:boolean}){
  const [rating,setRating]=useState<number|null>(reviewed?4:null);
  const [note,setNote]=useState(reviewed?sample.note:'');
  const [message,setMessage]=useState('');
  return <form className="design-record" aria-label="가상 기록 입력" onSubmit={event=>{event.preventDefault();setMessage('미리보기 안에만 반영했어요. 실제 기록에는 저장하지 않아요.');}}>
    <span className="design-record-caption">{sample.kind==='people'?'함께한 순간':sample.kind==='course'?'수업의 기억':'한 끼의 기억'}</span><h3>{sample.kind==='people'?'어떤 순간을 기억하고 싶나요?':'어떤 기억으로 남았나요?'}</h3>
    {sample.kind!=='people'?<fieldset><legend>{sample.kind==='course'?'나의 수업 만족도':'나의 별점'}</legend><div className="design-stars">{[1,2,3,4,5].map(n=><label key={n}><input type="radio" name="design-rating" aria-label={`미리보기 ${n}점`} checked={rating===n} onChange={()=>{setRating(n);setMessage('');}}/><span aria-hidden="true">{rating!==null&&n<=rating?'★':'☆'}</span></label>)}</div></fieldset>:<p className="design-record-hint">별명과 추억으로 간직해요. 사람에게 등급이나 별점을 매기지 않아요.</p>}
    <label>{sample.kind==='people'?'추억 한줄':'한줄평'}<textarea aria-label="가상 한줄 기록" value={note} onChange={e=>{setNote(e.target.value);setMessage('');}} placeholder={sample.kind==='people'?'함께 웃었던 순간을 남겨 보세요.':'기억하고 싶은 이야기를 남겨 보세요.'} rows={3} maxLength={500}/></label>
    <button className="design-save" type="submit">기록 저장 · 미리보기</button>{message?<p role="status">{message}</p>:null}
  </form>;
}

export function DesignPreviewLab(){
  const [kind,setKind]=useState<DesignKind>('meal');
  const [width,setWidth]=useState('desktop');
  const [size,setSize]=useState('normal');
  const [count,setCount]=useState(30);
  const [owned,setOwned]=useState(1);
  const [edition,setEdition]=useState<CardEdition|'mixed'>('mixed');
  const [reviewed,setReviewed]=useState(false);
  const [index,setIndex]=useState(0);
  const [copy,setCopy]=useState(0);
  if(process.env.NODE_ENV!=='development')return null;
  const samples=createDesignSamples(kind,count,kind==='meal'&&edition!=='mixed'?edition:undefined);
  const sample=samples[Math.min(index,samples.length-1)];
  function changeKind(value:DesignKind){setKind(value);setIndex(0);setCopy(0);}
  return <div className="design-lab"><Link href="/dex/dev" className="dex-back">← 개발자 도구</Link><h2>컬렉션 앨범 디자인 실험실</h2><p className="design-warning">개발 전용 · 모든 샘플은 가상입니다. 입력·저장 버튼은 실제 도감·업적·통계를 변경하지 않습니다.</p>
    <p className="dex-small dex-muted">기본 방향은 컬렉션 앨범입니다. 최종 디자인은 후속 작업에서 다듬습니다.</p><div className="design-toolbar"><div role="group" aria-label="도감 샘플">{(['meal','people','course'] as const).map(value=><button key={value} aria-pressed={kind===value} onClick={()=>changeKind(value)}>{DESIGN_LABELS[value]}</button>)}</div></div>
    <details className="design-options"><summary>미리보기 조절</summary><div><label>화면 폭<select aria-label="디자인 화면 폭" value={width} onChange={e=>setWidth(e.target.value)}><option value="desktop">데스크톱 · 최대 1060px</option><option value="mobile">모바일 · 최대 390px</option></select></label><label>카드 크기<select aria-label="디자인 카드 크기" value={size} onChange={e=>setSize(e.target.value)}><option value="small">작게</option><option value="normal">보통</option><option value="large">크게</option></select></label><label>{kind==='people'?'추억 기록 수':'보유 카드 수'}<select aria-label="디자인 보유 수" value={owned} onChange={e=>{setOwned(Number(e.target.value));setCopy(0);}}><option value={1}>1개</option><option value={3}>여러 개 · 3개</option></select></label>{kind==='meal'?<label>카드 에디션<select aria-label="디자인 카드 에디션" value={edition} onChange={e=>setEdition(e.target.value as typeof edition)}><option value="mixed">기본 혼합</option>{CARD_EDITIONS.map(value=><option key={value} value={value}>{value}</option>)}</select></label>:null}<label>{kind==='people'?'추억':'평가·메모'} 상태<select aria-label="디자인 기록 상태" value={reviewed?'after':'before'} onChange={e=>setReviewed(e.target.value==='after')}><option value="before">입력 전</option><option value="after">입력 후</option></select></label><label>컬렉션 수<select aria-label="디자인 컬렉션 수" value={count} onChange={e=>{setCount(Number(e.target.value));setIndex(0);setCopy(0);}}>{[5,30,100].map(n=><option key={n} value={n}>{n}개</option>)}</select></label></div></details>
    <section className="dex-design-preview" data-concept="album" data-size={size} style={{maxWidth:width==='mobile'?390:1060}} aria-label="공통 도감 디자인 미리보기">
      <header className="design-heading"><div><span className="design-bookmark">차곡차곡 모은 나의 발견</span><h2>{DESIGN_LABELS[kind]}</h2></div><span className="design-count">{samples.length}개의 가상 기록</span></header>
      <section className="design-feature" aria-label="선택 카드와 기록"><div className="design-feature-card"><DesignPreviewCard sample={sample} featured/>{owned>1?<div className="design-copy-picker" role="group" aria-label="가상 획득 기록">{Array.from({length:owned},(_,i)=><button key={i} aria-pressed={copy===i} onClick={()=>setCopy(i)}>{kind==='people'?'추억':'카드'} {i+1}</button>)}</div>:null}</div><RecordPreview key={`${kind}:${sample.id}:${copy}:${reviewed}`} sample={sample} reviewed={reviewed}/></section>
      <section className="design-collection"><div className="design-section-heading"><h3>나의 컬렉션</h3><p>카드를 골라 가까이에서 기록해 보세요.</p></div><div className="design-gallery" data-testid="design-gallery">{samples.map((item,i)=><DesignPreviewCard key={item.id} sample={item} showRecord={reviewed} selected={i===index} onSelect={()=>{setIndex(i);setCopy(0);}}/>)}</div></section>
    </section>
  </div>;
}
