'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CourseEntry } from '@/lib/dex/course/course';
import { completedCourse, DIFFICULTIES, REVIEW_TAGS, WORKLOADS } from '@/lib/dex/course/review';
import type { CourseReview } from '@/lib/dex/course/review';

export function CourseCompletion({ status }: { status: CourseEntry['subject']['status'] }) {
  return completedCourse(status) ? <span className="dex-tag self-start">✓ 수강 완료 도장</span> : null;
}

export function CourseReviewPanel({ entry, busy, onSave }: {
  entry: CourseEntry;
  busy: boolean;
  onSave: (entry: CourseEntry, review?: CourseReview) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<CourseEntry>();
  const review = entry.subject.review;
  const original = editing?.subject.review;
  const control = 'block w-full rounded border bg-transparent p-2';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    const fields = new FormData(event.currentTarget);
    const shortReview = String(fields.get('shortReview') ?? '').trim();
    const difficulty = Number(fields.get('difficulty')) as CourseReview['difficulty'];
    const workload = fields.get('workload') as CourseReview['workload'];
    const team = fields.get('teamProject');
    const tags = REVIEW_TAGS.filter(tag => fields.getAll('tags').includes(tag));
    const next: CourseReview = {
      ...(shortReview && { shortReview }),
      ...(difficulty && { difficulty }),
      ...(workload && { workload }),
      ...(team === 'yes' || team === 'no' ? { teamProject: team === 'yes' } : {}),
      ...(tags.length && { tags }),
    };
    if (await onSave(editing, Object.keys(next).length ? next : undefined)) setEditing(undefined);
  }

  return <section className="space-y-2 border-t pt-3">
    <h3 className="font-semibold">나의 평가</h3>
    {editing ? <form onSubmit={submit}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">한줄평<textarea name="shortReview" className={control} maxLength={300} defaultValue={original?.shortReview} /></label>
        <label className="block">체감 난이도<select name="difficulty" className={control} defaultValue={original?.difficulty ?? ''}>
          <option value="">미기록</option>
          {DIFFICULTIES.map((label, index) => <option key={label} value={index + 1}>{index + 1} · {label}</option>)}
        </select></label>
        <label className="block">과제량<select name="workload" className={control} defaultValue={original?.workload ?? ''}>
          <option value="">미기록</option>
          {Object.entries(WORKLOADS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="block">팀 프로젝트<select name="teamProject" className={control} defaultValue={original?.teamProject === undefined ? '' : original.teamProject ? 'yes' : 'no'}>
          <option value="">미기록</option><option value="yes">있음</option><option value="no">없음</option>
        </select></label>
        <fieldset className="flex flex-wrap gap-2">
          <legend>강의 특징</legend>
          {REVIEW_TAGS.map(tag => <label key={tag} className="flex items-center gap-1">
            <input type="checkbox" name="tags" value={tag} defaultChecked={original?.tags?.includes(tag)} />{tag}
          </label>)}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="dex-button">{busy ? '저장 중…' : '평가 저장'}</button>
          <button type="button" className="dex-button" onClick={() => setEditing(undefined)}>취소</button>
        </div>
      </fieldset>
    </form> : <>
      {review ? <>
        {review.shortReview && <p className="whitespace-pre-wrap break-words">{review.shortReview}</p>}
        {review.difficulty && <p>체감 난이도 · {DIFFICULTIES[review.difficulty - 1]}</p>}
        {review.workload && <p>과제량 · {WORKLOADS[review.workload]}</p>}
        {review.teamProject !== undefined && <p>팀 프로젝트 · {review.teamProject ? '있음' : '없음'}</p>}
        {!!review.tags?.length && <p>강의 특징 · {review.tags.join(' · ')}</p>}
      </> : <p>아직 남긴 평가가 없어요.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="dex-button" disabled={busy} onClick={() => setEditing(entry)}>{review ? '평가 수정' : '나의 평가 작성'}</button>
        {review && <button type="button" className="dex-button" disabled={busy} onClick={() => {
          if (window.confirm('이 강의의 평가를 초기화할까요?')) void onSave(entry);
        }}>평가 초기화</button>}
      </div>
    </>}
  </section>;
}
