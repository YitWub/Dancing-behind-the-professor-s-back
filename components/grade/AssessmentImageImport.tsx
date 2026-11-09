'use client';

import { useEffect, useRef, useState } from 'react';
import { IMAGE_MAX_BYTES, IMAGE_TYPES, parseImageExtraction, buildWeightPreview, validateWeightPreview, applyWeightPreview, type WeightPreview } from '@/lib/grade/assessment-image';
import { parseAssessmentOcr, ocrNeedsReview } from '@/lib/grade/assessment-ocr';
import type { ManagedAssessment } from '@/lib/grade/management-types';

const fieldClass = 'w-full rounded-lg border border-[var(--e-border-strong)] bg-[var(--e-surface)] px-3 py-2 text-[13px] text-[var(--e-ink)] outline-none focus:border-[var(--e-accent)]';
const buttonClass = 'rounded-lg border border-[var(--e-border-strong)] px-3 py-2 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';
type PreparedImage = { data: string; blob: Blob };

async function prepareImage(file: File): Promise<PreparedImage> {
  if (!IMAGE_TYPES.includes(file.type as typeof IMAGE_TYPES[number]) || file.size === 0 || file.size > IMAGE_MAX_BYTES) throw Error('3MB 이하 PNG·JPEG·WebP 이미지를 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 20000000 || Math.max(bitmap.width, bitmap.height) > 8000) throw Error('이미지가 너무 큽니다. 평가표만 잘라서 올려 주세요.');
    const scale = Math.min(2, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw Error('이 브라우저에서는 이미지 처리를 지원하지 않습니다.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(Error('이미지를 읽지 못했습니다. 다른 캡처를 선택해 주세요.')), 'image/jpeg', .94));
    if (blob.size > IMAGE_MAX_BYTES) throw Error('이미지가 너무 큽니다. 평가표만 잘라서 올려 주세요.');
    return { blob, data: canvas.toDataURL('image/jpeg', .94).split(',')[1] };
  } finally { bitmap.close(); }
}

export function AssessmentImageImport({ assessments, onApply, preserveAssessmentIds = [] }: { assessments: ManagedAssessment[]; onApply: (rows: ManagedAssessment[]) => void; preserveAssessmentIds?: string[] }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [rows, setRows] = useState<WeightPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hasImage, setHasImage] = useState(false);
  const [source, setSource] = useState<'ocr' | 'gemini'>('ocr');
  const image = useRef<PreparedImage | null>(null);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const invalidate = () => { revision.current++; request.current?.abort(); image.current = null; };
    fetch('/api/grade/assessment-image', { signal: controller.signal, cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((v) => { if (!controller.signal.aborted) setAvailable(v?.available === true); }).catch(() => { if (!controller.signal.aborted) setAvailable(false); });
    return () => { controller.abort(); invalidate(); };
  }, []);

  const cancel = () => { revision.current++; request.current?.abort(); image.current = null; setHasImage(false); setBusy(false); setRows(null); setError(''); setNotice(''); };
  const upload = async (file: File) => {
    cancel();
    const version = revision.current, controller = new AbortController();
    request.current = controller; setBusy(true); setSource('ocr'); setNotice('이미지 확인 중…');
    try {
      const prepared = await prepareImage(file);
      if (version !== revision.current || controller.signal.aborted) return;
      image.current = prepared; setHasImage(true);
      const { recognizeAssessmentImage } = await import('./assessment-ocr-client');
      const result = await recognizeAssessmentImage(prepared.blob, controller.signal, (message) => { if (version === revision.current) setNotice(message); });
      if (version !== revision.current || controller.signal.aborted) return;
      const parsed = parseAssessmentOcr(result.text, result.confidence);
      if (parsed.status === 'ok' && parsed.items.length) setRows(buildWeightPreview(assessments, parsed));
      setNotice(ocrNeedsReview(parsed) ? 'OCR 결과를 확인해 주세요. 누락·오독이 있으면 직접 수정하거나 Gemini로 다시 분석할 수 있습니다.' : `OCR로 ${parsed.items.length}개 항목을 읽었습니다. 사진과 비교한 뒤 적용해 주세요.`);
    } catch (e) {
      if (version === revision.current && !controller.signal.aborted) { setNotice(''); setError(e instanceof Error ? `OCR 인식에 실패했습니다. ${e.message}` : 'OCR 인식에 실패했습니다. Gemini로 다시 분석하거나 직접 입력해 주세요.'); }
    } finally { if (version === revision.current) setBusy(false); }
  };

  const analyzeWithGemini = async () => {
    if (busy || available !== true || !image.current) return;
    request.current?.abort();
    const version = ++revision.current, controller = new AbortController(), prepared = image.current;
    request.current = controller; setBusy(true); setError(''); setNotice('Gemini로 다시 분석 중…');
    try {
      const response = await fetch('/api/grade/assessment-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaType: 'image/jpeg', data: prepared.data }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) });
      const result = await response.json();
      if (!response.ok) throw Error(typeof result.error === 'string' ? result.error : 'Gemini 분석에 실패했습니다.');
      const parsed = parseImageExtraction(result);
      if (parsed.status !== 'ok' || !parsed.items.length) throw Error(parsed.status === 'ambiguous' ? '평가표가 여러 개이거나 구분이 어렵습니다. 표 하나만 잘라 다시 선택해 주세요.' : '평가항목을 읽지 못했습니다. 직접 입력하거나 선명한 캡처로 다시 시도해 주세요.');
      if (version === revision.current && !controller.signal.aborted) { setRows(buildWeightPreview(assessments, parsed)); setSource('gemini'); setNotice('Gemini 결과를 사진과 비교한 뒤 적용해 주세요.'); }
    } catch (e) {
      if (version === revision.current && !controller.signal.aborted) { setNotice(''); setError(e instanceof Error ? e.message : 'Gemini 분석에 실패했습니다. OCR 결과를 수정하거나 직접 입력해 주세요.'); }
    } finally { if (version === revision.current) setBusy(false); }
  };
  const check = rows ? validateWeightPreview(rows) : null;
  const patch = (id: string, value: Partial<WeightPreview>) => setRows((r) => r?.map((x) => x.id === id ? { ...x, ...value } : x) ?? null);

  return <section aria-label="평가비율 사진으로 입력" className="rounded-xl border border-[var(--e-border)] p-3">
    <h4 className="text-[14px] font-semibold">평가비율 사진으로 입력</h4>
    <p className="mt-1 text-[12px] text-[var(--e-muted)]">먼저 브라우저 OCR로 읽어요. API 키 없이 사용할 수 있고 이미지는 서버로 보내지 않습니다. 처음에는 인식 파일 다운로드에 인터넷이 필요합니다.</p>
    <div className="mt-3 rounded-lg border border-dashed border-[var(--e-border-strong)] p-3 focus-visible:outline-2" tabIndex={0} aria-label="평가표 캡처 붙여넣기" onPaste={(event) => {
      const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'));
      if (file && !busy) { event.preventDefault(); void upload(file); }
    }}>
      <label className={buttonClass + ' inline-flex min-h-11 items-center ' + (busy ? 'opacity-50' : 'cursor-pointer')}><span>{busy ? '인식 중…' : '이미지 선택 · OCR로 읽기'}</span><input aria-label="평가비율 이미지 선택" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} /></label>
      <p className="mt-2 text-[12px] text-[var(--e-muted)]">이 영역을 클릭하고 Ctrl+V로 캡처를 붙여넣어도 됩니다. 3MB 이하 PNG·JPEG·WebP, 개인정보가 없는 평가표만 선택해 주세요.</p>
    </div>
    {busy ? <button type="button" className={buttonClass + ' mt-2 min-h-11'} onClick={cancel}>분석 취소</button> : null}
    {notice ? <p role="status" className="mt-2 text-[12px]">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 text-[13px]">{error}</p> : null}
    {hasImage ? <div className="mt-3 rounded-lg bg-[var(--e-surface-2)] p-3">
      <p className="text-[12px]">잘 안 읽혔나요? 아래 버튼을 누를 때만 선택한 이미지를 Google Gemini로 보냅니다. 무료 등급에서는 서비스 개선에 사용될 수 있으며 사용량 한도가 적용됩니다.</p>
      <button type="button" className={buttonClass + ' mt-2 min-h-11'} disabled={available !== true || busy} onClick={() => void analyzeWithGemini()}>Gemini로 다시 분석</button>
      {available !== true ? <p className="mt-2 text-[12px]">{available === null ? 'Gemini 설정 확인 중… OCR 결과는 그대로 사용할 수 있습니다.' : 'Gemini 키·모델 설정이 없어 재분석은 사용할 수 없습니다. OCR 결과를 수정하거나 직접 입력해 주세요.'}</p> : null}
    </div> : null}
    {rows ? <fieldset disabled={busy} className="mt-3 space-y-3">
      <h5 className="text-[14px] font-semibold">인식 결과를 확인해 주세요 <span className="text-[12px] text-[var(--e-muted)]">({source === 'ocr' ? '브라우저 OCR' : 'Gemini'})</span></h5>
      <p className="text-[12px]">아직 반영되지 않았어요. 사진의 항목과 비율을 기준으로 적용합니다. 사진에 없는 기본 항목은 제외하고, 입력한 점수·과제 기록이 있는 항목만 0%로 보관합니다.</p>
      {rows.map((r) => <div key={r.id} className="rounded-lg bg-[var(--e-surface-2)] p-3"><div className="grid grid-cols-[1fr_5rem] gap-2"><label className="min-w-0 text-[12px]">항목명<input aria-label={`인식 항목명 ${r.id}`} className={fieldClass} value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} /></label><label className="text-[12px]">비율 (%)<input aria-label={`인식 비율 ${r.id}`} className={fieldClass} type="number" min={0} max={100} value={r.percent} onChange={(e) => patch(r.id, { percent: e.target.value })} /></label></div>
        <p className="mt-1 text-[12px] text-[var(--e-muted)]">{r.parent ? `${r.parent}의 세부 항목 · 중복 합산 방지를 위해 제외` : r.source === 'existing' ? '사진에 없는 기존 항목 · 점수·과제 기록 유지' : r.targetId ? '기존 항목 연결 · 점수·과제 기록 유지' : '새 평가항목'}</p>
        {r.source === 'image' && !r.parent ? <label className="mt-1 flex min-h-9 items-center gap-2 text-[12px]"><input type="checkbox" checked={r.included} onChange={(e) => patch(r.id, { included: e.target.checked })} />적용에 포함</label> : null}
        {r.needsReview && r.included ? <label className="mt-1 flex min-h-9 items-center gap-2 text-[12px]"><input type="checkbox" checked={false} onChange={() => patch(r.id, { needsReview: false })} />확인 필요 · 이미지와 대조했어요</label> : null}
      </div>)}
      <p role="status" className="text-[14px] font-semibold">합계 {Number(check!.total.toFixed(4))}% {check!.errors.length === 0 ? '✓' : ''}</p>
      {check!.errors.length ? <ul className="space-y-1 text-[12px]">{check!.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass + ' min-h-11 bg-[var(--e-secured)] text-white'} disabled={check!.errors.length > 0 || busy} onClick={() => {
        const planned = applyWeightPreview(assessments, rows, () => crypto.randomUUID(), preserveAssessmentIds);
        if (!planned.ok) { setError(planned.errors.join(' ')); return; }
        const changes = planned.value.flatMap((a) => { const old = assessments.find((x) => x.id === a.id); return old && Math.abs(old.weight - a.weight) > 1e-8 ? [`${old.name}: ${Number((old.weight * 100).toFixed(4))}% → ${Number((a.weight * 100).toFixed(4))}% (기존 기록 유지)`] : []; });
        if (changes.length && !window.confirm(`평가비율을 변경할까요?\n\n${changes.join('\n')}\n\n이미 입력한 점수와 과제 기록은 유지됩니다.`)) return;
        onApply(planned.value); cancel();
      }}>이대로 적용</button><button type="button" className={buttonClass + ' min-h-11'} onClick={cancel}>적용 취소</button></div>
    </fieldset> : null}
  </section>;
}
