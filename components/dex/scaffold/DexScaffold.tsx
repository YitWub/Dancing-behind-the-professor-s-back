'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { DexKind, EntrySubject } from '@/lib/dex/core/types';
import { Card } from '@/components/ui';
import { useDexDocument } from './useDexDocument';
import { GrassGrid } from '@/components/dex/common/GrassGrid';
import { kstToday } from '@/lib/datetime';
import { CollectionArtwork, mealArtwork } from '@/components/dex/common/CollectionArtwork';
import { CollectionCard } from '@/components/dex/common/CollectionCard';

const CATEGORIES = [
  {kind:'course', icon:'📚', name:'강의도감', description:'수강한 강의와 기억을 모아요.', href:'/dex/course'},
  {kind:'meal', icon:'🍽️', name:'학식도감', description:'직접 먹은 메뉴와 다시 찾은 경험을 기록해요.', href:'/dex/meal'},
  {kind:'people', icon:'🤝', name:'인연도감', description:'함께한 인연을 별명과 메모로 간직해요.', href:'/dex/people'},
  {kind:'professor', icon:'🎓', name:'교수도감', description:'수업에서 만난 교수님과 배운 과목을 모아요.', href:'/dex/professor'},
  {kind:'custom', icon:'📖', name:'자유도감', description:'장소, 활동, 추억을 나만의 도감으로 모아요.', href:'/dex/custom'},
] as const;
function label(subject: EntrySubject) { return subject.kind==='meal'?subject.displayNameSnapshot:subject.kind==='person'||subject.kind==='professor'?subject.displayName:subject.title; }

/** A 인수 골격: B/C는 도메인 화면, D는 카드·연출 컴포넌트를 후속 교체한다. */
export function DexHomeScaffold() {
  const {data,loading,error,reload}=useDexDocument();
  const [now]=useState(()=>Date.now());
  const today=kstToday();
  const entries=data?.entries??[];
  const recent=[...entries].sort((a,b)=>b.firstCollectedAt.localeCompare(a.firstCollectedAt)).slice(0,3);
  const todayCount=entries.filter(e=>e.collectedOn===today).length;
  return <div className="bk-screen">
    {loading?<p role="status">이 브라우저의 기록을 불러오는 중…</p>:null}
    {error?<p role="alert">{error} <button type="button" className="bk-link" onClick={()=>void reload()}>다시 읽기</button></p>:null}

    <Link href="/dex/meal/collection" className="bk-today" data-done={todayCount>0?'':undefined}>
      <span className="bk-today-pocket" aria-hidden="true"><i/><i/><i/></span>
      <span className="bk-today-main">{todayCount>0?`오늘 ${todayCount}장 꽂음`:'오늘 칸 꽂기'}</span>
      <span className="bk-today-sub">{todayCount>0?'한 장 더 꽂을 수 있어요':'오늘 만난 한 끼부터 기록해요'}</span>
    </Link>

    <GrassGrid dates={entries.map(e=>e.collectedOn)}/>

    <section className="bk-section" aria-labelledby="bk-binders">
      <header className="bk-section-head"><h2 id="bk-binders">내 바인더</h2><span>{data?`${entries.length}장 수집`:'불러오는 중'}</span></header>
      <ul className="bk-binder-grid">
        {CATEGORIES.map(category=>{
          const ids=new Set(data?.dexes.filter(d=>d.kind===category.kind).map(d=>d.id));
          const count=data?.entries.filter(e=>ids.has(e.dexId)).length??0;
          return <li key={category.kind}>
            <Link href={category.href} className="bk-binder" data-kind={category.kind}>
              <span className="bk-binder-spine" aria-hidden="true"/>
              <span className="bk-binder-zip" aria-hidden="true">{Array.from({length:6},(_,z)=><i key={z}/>)}</span>
              <span className="bk-binder-plate">
                <strong>{category.name}</strong>
                <span data-testid={`count-${category.kind}`}>{data?`${count}장`:'확인 중'}</span>
              </span>
            </Link>
          </li>;
        })}
      </ul>
    </section>

    <section className="bk-section" aria-labelledby="bk-recent">
      <header className="bk-section-head"><h2 id="bk-recent">최근에 꽂은 카드</h2></header>
      {recent.length?<div className="dex-card-grid">{recent.map(entry=><CollectionCard key={entry.id} title={label(entry.subject)} isNew={now-Date.parse(entry.firstCollectedAt)>=0&&now-Date.parse(entry.firstCollectedAt)<7*86400000} artwork={<CollectionArtwork kind={entry.subject.kind==='meal'?mealArtwork(label(entry.subject)):entry.subject.kind==='person'?'people':entry.subject.kind==='professor'?'professor':'custom'}/>} href={entry.subject.kind==='meal'?`/dex/meal/collection/${entry.id}`:entry.subject.kind==='professor'?'/dex/professor':undefined} meta={`첫 기록 ${entry.collectedOn}`}/>)}</div>
        :<div className="bk-empty"><p>아직 꽂은 카드가 없어요.</p><Link href="/dex/meal?view=discover" className="bk-link">첫 번째 메뉴 만나러 가기 ↗</Link></div>}
    </section>

    {process.env.NODE_ENV==='development'?<p className="bk-muted"><Link className="bk-link" href="/dex/dev">개발자 도구 ↗</Link></p>:null}
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
