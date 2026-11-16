import Link from 'next/link';
import type { PersonEntry } from '@/lib/dex/people/view';
export function PersonAvatar({name}:{name:string}){return <div className="people-avatar" aria-hidden="true"><span>{Array.from(name.trim())[0]||'♡'}</span></div>;}
/** Presentation only: a future manually positioned board can reuse the same card. */
export function PersonCard({entry,note}:{entry:PersonEntry;note?:string}){const p=entry.subject;return <Link className="people-polaroid" href={`/dex/people/${entry.id}`}><span className="people-pin" aria-hidden="true"/><PersonAvatar name={p.displayName}/><h3>{p.displayName}</h3>{p.admissionYear||p.department?<p>{[p.admissionYear&&p.admissionYear+'학번',p.department].filter(Boolean).join(' · ')}</p>:null}{p.relationship?<span className="people-context">{p.relationship}</span>:null}{note?<p className="people-card-note">{note}</p>:null}</Link>;}
