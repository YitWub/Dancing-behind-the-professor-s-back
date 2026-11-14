'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui';
import type { DexKind, EntrySubject } from '@/lib/dex/core/types';
import { useDexDocument } from './useDexDocument';
import { BackupControls } from './BackupControls';
import { CollectionArtwork, mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { CollectionCard } from '@/components/dex/common/CollectionCard';

const CATEGORIES = [
  {kind:'meal', icon:'🍽️', name:'학식도감', description:'직접 먹은 메뉴와 다시 찾은 경험을 기록해요.', href:'/dex/meal'},
  {kind:'people', icon:'🤝', name:'인연도감', description:'함께한 인연을 별명과 메모로 간직해요.', href:'/dex/people'},
  {kind:'custom', icon:'📖', name:'자유도감', description:'장소, 활동, 추억을 나만의 도감으로 모아요.', href:'/dex/custom'},
] as const;
function label(subject: EntrySubject) { return subject.kind==='meal'?subject.displayNameSnapshot:subject.kind==='person'?subject.displayName:subject.title; }

/** A 인수 골격: B/C는 도메인 화면, D는 카드·연출 컴포넌트를 후속 교체한다. */
export function DexHomeScaffold() {
  const {data,loading,error,reload}=useDexDocument();
  const [now]=useState(()=>Date.now());
  const recent=[...(data?.entries??[])].sort((a,b)=>b.firstCollectedAt.localeCompare(a.firstCollectedAt)).slice(0,3);
  return <div className="space-y-8">
    <section className="dex-home-hero"><div><span className="dex-eyebrow">A LITTLE DISCOVERY, EVERY DAY</span><h2>평범한 대학생활이<br/>나만의 <em>컬렉션</em>으로.</h2><p>맛있었던 한 끼, 함께한 인연, 소중한 순간.<br/>대학생활의 모든 발견을 수집하다.</p><Link className="dex-button" href="/dex/meal">나의 도감 펼쳐보기 ↗</Link></div><div className="dex-hero-stickers"><div><CollectionArtwork kind="rice"/></div><div><CollectionArtwork kind="custom"/></div><span>small moments,<br/>my own collection.</span></div></section>
    {loading?<p role="status">이 브라우저의 기록을 불러오는 중…</p>:null}
    {error?<p role="alert">{error} <button onClick={()=>void reload()} className="underline">다시 읽기</button></p>:null}
    <div className="grid gap-4 sm:grid-cols-3">
      {CATEGORIES.map(category=>{
        const ids=new Set(data?.dexes.filter(d=>d.kind===category.kind).map(d=>d.id));
        const count=data?.entries.filter(e=>ids.has(e.dexId)).length??0;
        return <Card key={category.kind} className="flex flex-col gap-3 p-5">
          <CollectionArtwork kind={category.kind==='meal'?'food':category.kind==='people'?'people':'custom'}/><h2 className="text-xl font-semibold">{category.name}</h2>
          <p className="flex-1 text-sm text-[var(--e-ink-2)]">{category.description}</p>
          <p data-testid={`count-${category.kind}`}>{data?`수집 ${count}개`:'수집 개수 확인 중'}</p>
          {data&&count===0?<p className="text-sm text-[var(--e-muted)]">아직 수집한 기록이 없어요.</p>:null}
          <Link href={category.href} className="rounded-lg bg-[var(--e-accent)] px-4 py-2 text-center text-white">{category.name} 열기</Link>
        </Card>;
      })}
    </div>
    <section><div className="dex-section-heading"><div><span className="dex-eyebrow">LITTLE MOMENTS, COLLECTED</span><h2>최근 발견한 카드</h2></div><span className="dex-tag">나만의 기록</span></div>{recent.length?<div className="dex-card-grid">{recent.map(entry=><CollectionCard key={entry.id} title={label(entry.subject)} isNew={now-Date.parse(entry.firstCollectedAt)>=0&&now-Date.parse(entry.firstCollectedAt)<7*86400000} artwork={<CollectionArtwork kind={entry.subject.kind==='meal'?mealArtwork(label(entry.subject)):entry.subject.kind==='person'?'people':'custom'}/>} href={entry.subject.kind==='meal'?`/dex/meal/collection/${entry.id}`:undefined} meta={`첫 기록 ${entry.collectedOn}`}/>)}</div>:<div className="dex-empty dex-empty--small"><h3>아직 비어 있는 첫 페이지</h3><p>직접 경험한 발견을 모으면 이곳에 카드가 쌓여요.</p><Link href="/dex/meal?view=discover" className="dex-back">첫 번째 메뉴 만나러 가기 ↗</Link></div>}</section>
    <BackupControls ownerId={data?.profile.ownerId} onChanged={reload}/>
    {process.env.NODE_ENV==='development'?<p className="text-sm"><Link className="underline" href="/dex/dev">개발 전용 · 격리 저장소 검증</Link></p>:null}
  </div>;
}

export function DexLandingScaffold({kind}:{kind:DexKind}) {
  const {data,loading,error,reload}=useDexDocument();
  const category=CATEGORIES.find(c=>c.kind===kind)!;
  const dexes=data?.dexes.filter(d=>d.kind===kind)??[];
  const ids=new Set(dexes.map(d=>d.id));
  const entries=data?.entries.filter(e=>ids.has(e.dexId))??[];
  return <Card className="space-y-4 p-5">
    <div className="dex-landing-art"><CollectionArtwork kind={kind==='people'?'people':kind==='custom'?'custom':'food'}/></div><span className="dex-eyebrow">YOUR NEXT CHAPTER</span><h2 className="text-2xl font-semibold">{category.name}</h2>
    <p>{category.description}</p>
    {loading?<p role="status">기록을 불러오는 중…</p>:null}
    {error?<p role="alert">{error} <button className="underline" onClick={()=>void reload()}>다시 읽기</button></p>:null}
    {data?<p>수집 {entries.length}개{kind==='custom'?` · 나만의 도감 ${dexes.length}개`:''}</p>:null}
    {kind==='people'?<p className="text-sm text-[var(--e-muted)]">이 브라우저에만 저장합니다. 같은 브라우저 프로필을 쓰는 사람은 기록에 접근할 수 있어요. 별점이나 사람의 가치 등급은 제공하지 않아요.</p>:null}
    {data&&kind==='custom'&&dexes.length>0?<ul className="space-y-2" aria-label="나만의 도감 목록">{dexes.map(d=><li key={d.id} className="rounded-lg bg-[var(--e-surface-2)] p-3">{d.name} · 수집 {entries.filter(e=>e.dexId===d.id).length}개</li>)}</ul>:null}
    {data&&entries.length===0?<p className="rounded-lg bg-[var(--e-surface-2)] p-4">아직 기록이 없어요. 이 화면은 담당자가 기능을 연결할 기본 영역입니다.</p>:null}
    {entries.length>0?<ul aria-label="수집 기록 목록" className="space-y-2">{entries.map(entry=><li key={entry.id} className="rounded-lg bg-[var(--e-surface-2)] p-3">{label(entry.subject)} · 경험 {data?.experiences.filter(e=>e.entryId===entry.id).length??0}회</li>)}</ul>:null}
    <p className="text-sm text-[var(--e-muted)]">{kind==='meal'?'실제 학식 메뉴 조회·선택 연결은 다음 단계에서 제공해요.':kind==='custom'?'도감 생성·편집 화면은 자유도감 담당자가 연결할 예정이에요.':'인연 등록·상세 편집 화면은 인연도감 담당자가 연결할 예정이에요.'}</p>
    <Link className="underline" href="/dex">도감 홈으로</Link>
  </Card>;
}
