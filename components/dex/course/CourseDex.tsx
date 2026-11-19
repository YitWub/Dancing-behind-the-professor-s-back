'use client';

import Link from 'next/link';
import { CourseReviewPanel, CourseCompletion } from './CourseReviewPanel';
import type { CourseReview } from '@/lib/dex/course/review';
import { CourseCollection } from './CourseCollection';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useDexDocument } from '../scaffold/useDexDocument';
import { getBrowserRepository } from '@/lib/dex/storage/browser';
import { kstToday, kstYear } from '@/lib/datetime';
import { CATEGORIES, STATUSES, TERMS, courseEntries, saveCourse, similarEnrollment } from '@/lib/dex/course/course';
import type { CourseEntry, CourseSubject } from '@/lib/dex/course/course';

export function CourseDex() {
  const { data, loading, error, reload } = useDexDocument();
  const [selectedId, select] = useState<string>();
  const [mode, setMode] = useState<'create' | 'edit' | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const pending = useRef(false);
  const request = useRef<{ payload: string; id: string; date: string } | null>(null);
  const editTarget = useRef<CourseEntry | undefined>(undefined);
  const entries = data ? courseEntries(data) : [];
  const selected = entries.find(entry => entry.id === selectedId);
  const detail = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedId && mode === null) detail.current?.focus();
  }, [selectedId, mode]);

  function navigate(id?: string, nextMode: typeof mode = null) {
    editTarget.current = nextMode === 'edit' ? entries.find(entry => entry.id === id) : undefined;
    select(id);
    setMode(nextMode);
    setFailure('');
    request.current = null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || pending.current) return;
    const fields = new FormData(event.currentTarget);
    const field = (name: string) => String(fields.get(name) ?? '').trim();
    const subject: CourseSubject = {
      kind: 'course', title: field('title'), year: Number(field('year')),
      term: field('term') as CourseSubject['term'], status: field('status') as CourseSubject['status'],
      professor: field('professor') || undefined, code: field('code') || undefined,
      credits: field('credits') ? Number(field('credits')) : undefined,
      category: (field('category') || undefined) as CourseSubject['category'], memo: field('memo') || undefined,
    };
    const editing = mode === 'edit' ? editTarget.current : undefined;
    if (mode === 'edit' && !editing) return;
    if (editing?.subject.review) subject.review = editing.subject.review;
    if (entries.some(e => e.id !== editing?.id && similarEnrollment(e.subject, subject)) &&
        !window.confirm('같은 학기에 이름·교수·코드가 같은 기록이 있어요. 별개의 수강 기록으로 저장할까요?')) return;
    const payload = JSON.stringify(subject);
    const attempt = request.current?.payload === payload ? request.current : { payload, id: crypto.randomUUID(), date: kstToday() };
    request.current = attempt;
    await run(async () => {
      const result = await saveCourse(getBrowserRepository(), data, subject, attempt.id, attempt.date, editing);
      if (!result.ok) { setFailure(result.error.message); return; }
      await reload();
      navigate(result.value.id);
    });
  }

  async function run(operation: () => Promise<void>) {
    pending.current = true;
    setBusy(true);
    setFailure('');
    try { await operation(); }
    catch { setFailure('저장 결과를 확인할 수 없어요. 다시 시도해 주세요.'); }
    finally { pending.current = false; setBusy(false); }
  }

  async function saveReview(entry: CourseEntry, review?: CourseReview) {
    if (!data || pending.current) return false;
    let saved = false;
    await run(async () => {
      const subject = { ...entry.subject };
      if (review) subject.review = review;
      else delete subject.review;
      const result = await getBrowserRepository().updateEntry(data.profile.ownerId, entry.id, entry.revision, { subject });
      if (!result.ok) { setFailure(result.error.message); return; }
      await reload();
      saved = true;
    });
    return saved;
  }

  async function remove(entry: CourseEntry) {
    if (!data || pending.current || !window.confirm('이 수강 기록을 삭제할까요?')) return;
    await run(async () => {
      const result = await getBrowserRepository().deleteEntry(data.profile.ownerId, entry.id, entry.revision);
      if (!result.ok) { setFailure(result.error.message); return; }
      await reload();
      navigate();
    });
  }

  return <section className="space-y-4">
    <Link className="dex-back" href="/dex">← 도감 홈</Link>
    <h1 className="text-2xl font-semibold">강의도감</h1>
    {loading && <p role="status">기록을 불러오는 중…</p>}
    {(error || failure) && <p role="alert">{error || failure}</p>}
    {data && <>
      <button className="dex-button" disabled={busy} onClick={() => navigate(undefined, 'create')}>강의 등록</button>
      {mode === 'create' || (mode === 'edit' && selected) ?
        <CourseForm key={selected?.id ?? 'new'} record={mode === 'edit' ? selected?.subject : undefined} busy={busy} onSubmit={save} onCancel={() => navigate(selectedId)} />
        : selected && <article ref={detail} tabIndex={-1} aria-label="강의 상세" className="space-y-2 rounded-lg border p-4">
          <h2 className="text-xl font-semibold">{selected.subject.title}</h2>
          <p>{selected.subject.year}년 {TERMS[selected.subject.term]} · {STATUSES[selected.subject.status]}</p>
          <CourseCompletion status={selected.subject.status} />
          <dl className="space-y-1">
            {selected.subject.professor && <div><dt>교수명</dt><dd>{selected.subject.professor}</dd></div>}
            {selected.subject.credits !== undefined && <div><dt>학점</dt><dd>{selected.subject.credits}</dd></div>}
            {selected.subject.category && <div><dt>강의 구분</dt><dd>{CATEGORIES[selected.subject.category]}</dd></div>}
            {selected.subject.code && <div><dt>과목 코드</dt><dd>{selected.subject.code}</dd></div>}
            {selected.subject.memo && <div><dt>개인 메모</dt><dd className="whitespace-pre-wrap">{selected.subject.memo}</dd></div>}
          </dl>
          <div className="flex gap-2">
            <button className="dex-button" disabled={busy} onClick={() => navigate(selected.id, 'edit')}>수정</button>
            <button className="dex-button" disabled={busy} onClick={() => void remove(selected)}>삭제</button>
          </div>
          <CourseReviewPanel key={selected.id} entry={selected} busy={busy} onSave={saveReview} />
        </article>}
      <CourseCollection entries={entries} busy={busy} onSelect={id => navigate(id)} />
    </>}
  </section>;
}

function CourseForm({ record, busy, onSubmit, onCancel }: {
  record?: CourseSubject;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const options = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>);
  const input = 'block w-full rounded border bg-transparent p-2';
  return <form onSubmit={onSubmit} className="rounded-lg border p-4">
    <fieldset disabled={busy} className="space-y-3">
      <legend className="font-semibold">{record ? '수강 기록 수정' : '새 강의 등록'}</legend>
      <label className="block">강의명<input className={input} name="title" required maxLength={120} defaultValue={record?.title} /></label>
      <label className="block">수강 연도<input className={input} name="year" type="number" required min={1900} max={2200} defaultValue={record?.year ?? kstYear()} /></label>
      <label className="block">수강 학기<select className={input} name="term" required defaultValue={record?.term ?? ''}><option value="" disabled>학기 선택</option>{options(TERMS)}</select></label>
      <label className="block">수강 상태<select className={input} name="status" defaultValue={record?.status ?? 'active'}>{options(STATUSES)}</select></label>
      <label className="block">교수명<input className={input} name="professor" maxLength={80} defaultValue={record?.professor} /></label>
      <label className="block">학점<input className={input} name="credits" type="number" min={0} max={30} step="any" defaultValue={record?.credits} /></label>
      <label className="block">강의 구분<select className={input} name="category" defaultValue={record?.category ?? ''}><option value="">미선택</option>{options(CATEGORIES)}</select></label>
      <label className="block">과목 코드<input className={input} name="code" maxLength={80} defaultValue={record?.code} /></label>
      <label className="block">개인 메모<textarea className={input} name="memo" maxLength={500} defaultValue={record?.memo} /></label>
      <div className="flex gap-2"><button className="dex-button" type="submit">{busy ? '저장 중…' : '저장'}</button><button className="dex-button" type="button" onClick={onCancel}>취소</button></div>
    </fieldset>
  </form>;
}
