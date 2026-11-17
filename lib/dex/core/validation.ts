import {MBTI_TYPES,GENDER_LABELS,ENERGY_LABELS,hasPersonDetails} from '../people/person-fields.ts';
import {AVATAR_IDS,isCharacterAvatar} from '../people/avatars.ts';
import { validateBoardCollection } from '../people/multi-board.ts';
import { validatePeopleBoard } from '../people/board.ts';
import { isIsoDate } from '../../datetime.ts';
import { ensure, DexError } from './errors.ts';
import type { BackupEnvelope, CollectCommand, DexDocument, EntrySubject, ExperienceDraft } from './types.ts';

type ObjectValue = Record<string, unknown>;
export function object(value: unknown, allowed: string[]): asserts value is ObjectValue {
  ensure(!!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, '객체 형식이 올바르지 않습니다.');
  ensure(Object.keys(value).every(key => allowed.includes(key)), '지원하지 않는 필드가 있습니다.');
}
export function text(value: unknown, max = 500, empty = false): asserts value is string {
  ensure(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), `문자열은 ${max}자 이내여야 합니다.`);
}
export function id(value: unknown): asserts value is string {
  ensure(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value), '식별자가 올바르지 않습니다.');
}
function natural(value: unknown, positive = false) {
  ensure(Number.isSafeInteger(value) && (value as number) >= (positive ? 1 : 0), '버전·수량이 올바르지 않습니다.');
}
function instant(value: unknown) {
  ensure(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'UTC 저장 시각이 올바르지 않습니다.');
}
export function date(value: unknown): asserts value is string {
  ensure(typeof value === 'string' && isIsoDate(value), '실제 달력 날짜(YYYY-MM-DD)가 필요합니다.');
}
function versioned(v: ObjectValue) {
  id(v.id); natural(v.revision, true); instant(v.createdAt); instant(v.updatedAt);
  ensure((v.updatedAt as string) >= (v.createdAt as string), '수정 시각이 생성 시각보다 빠릅니다.');
}
const base = ['id', 'revision', 'createdAt', 'updatedAt'];
export const ICONS = ['meal', 'people', 'book', 'place', 'coffee', 'star', 'club', 'memory'] as const;
export function subject(value: unknown): asserts value is EntrySubject {
  ensure(!!value && typeof value === 'object', '수집 항목이 필요합니다.');
  const v = value as ObjectValue;
  if (v.kind === 'meal') { object(v, ['kind', 'dishId', 'displayNameSnapshot']); id(v.dishId); text(v.displayNameSnapshot, 200); }
  else if (v.kind === 'person') {
    object(v, ['kind', 'displayName', 'admissionYear', 'department', 'relationship', 'memo', 'nickname', 'trait', 'tags', 'avatar', 'profileAssetId', 'characterIntro', 'age', 'gender', 'mbti', 'energyType']); text(v.displayName, 80);
    if(v.age!==undefined)ensure(Number.isInteger(v.age)&&(v.age as number)>=0&&(v.age as number)<=150,'나이는 0~150의 정수로 직접 입력해 주세요.');
    if(v.gender!==undefined)ensure(typeof v.gender==='string'&&Object.hasOwn(GENDER_LABELS,v.gender),'성별을 확인해 주세요.');
    if(v.mbti!==undefined)ensure(MBTI_TYPES.includes(v.mbti as typeof MBTI_TYPES[number]),'MBTI를 확인해 주세요.');
    if(v.energyType!==undefined)ensure(typeof v.energyType==='string'&&Object.hasOwn(ENERGY_LABELS,v.energyType),'에겐·테토 선택을 확인해 주세요.');
    if (v.admissionYear !== undefined) ensure(Number.isInteger(v.admissionYear) && (v.admissionYear as number) >= 1900 && (v.admissionYear as number) <= 2200, '입학 연도를 확인해 주세요.');
    for (const key of ['department', 'relationship']) if (v[key] !== undefined) text(v[key], 80, true);
    if (v.memo !== undefined) text(v.memo, 500, true);
    if(v.nickname!==undefined)text(v.nickname,40,true);
    if(v.trait!==undefined)text(v.trait,500,true);
    if(v.tags!==undefined){ensure(Array.isArray(v.tags)&&v.tags.length<=3,'특징 태그는 3개까지입니다.');for(const tag of v.tags)text(tag,16);ensure(new Set(v.tags).size===v.tags.length,'중복 태그를 확인해 주세요.');}
    if(v.avatar!==undefined)ensure(AVATAR_IDS.includes(v.avatar as string),'아바타를 확인해 주세요.');
    if(v.characterIntro!==undefined)text(v.characterIntro,300,true);
    if(v.profileAssetId!==undefined)ensure(typeof v.profileAssetId==='string'&&/^img-[a-f0-9]{64}$/.test(v.profileAssetId),'프로필 이미지 참조를 확인해 주세요.');
  } else { ensure(v.kind === 'custom', '지원하지 않는 항목 종류입니다.'); object(v, ['kind', 'title', 'memo']); text(v.title, 120); if (v.memo !== undefined) text(v.memo, 500, true); }
}
import { CARD_EDITIONS, normalizeLegacyCards } from '../meal/card-editions.ts';
const experienceFields = ['kind', 'experiencedOn', 'note'];
function experienceData(v: ObjectValue, saved: boolean) {
  const fields = saved ? [...base, 'ownerId', 'dexId', 'entryId', 'requestId'] : [];
  date(v.experiencedOn);
  if (v.note !== undefined) text(v.note, 500, true);
  if (v.kind === 'meal') {
    object(v, [...fields, ...experienceFields, 'rating', 'offeringId', 'context', ...(saved?['card']:[])]);
    if(saved&&v.card!==undefined){
      object(v.card,['id','edition','acquiredAt','policyVersion','origin']);
      ensure(v.card.id==='card-v1:'+v.id&&CARD_EDITIONS.includes(v.card.edition as typeof CARD_EDITIONS[number]),'카드 식별자·에디션을 확인해 주세요.');
      instant(v.card.acquiredAt); text(v.card.policyVersion,80);
      ensure(v.card.acquiredAt===v.createdAt&&['random','legacy'].includes(v.card.origin as string),'카드 획득 정보가 올바르지 않습니다.');
      if(v.card.origin==='legacy')ensure(v.card.edition==='NORMAL'&&v.card.policyVersion==='legacy-normal-v1','이전 기록의 카드는 NORMAL입니다.');
    }
    ensure(v.rating === null || (Number.isInteger(v.rating) && (v.rating as number) >= 1 && (v.rating as number) <= 5), '별점은 1~5 정수 또는 null입니다.');
    id(v.offeringId);
    object(v.context, ['date', 'cafeteria', 'mealTime', 'legacyMealItemId', 'snapshot', 'source']);
    date(v.context.date); text(v.context.legacyMealItemId, 200); text(v.context.source, 2000);
    ensure(['haksik', 'changbo', 'dorm', 'faculty'].includes(v.context.cafeteria as string), '식당을 확인해 주세요.');
    ensure(['breakfast', 'lunch', 'dinner'].includes(v.context.mealTime as string), '끼니를 확인해 주세요.');
    object(v.context.snapshot, ['name', 'menu', 'price', 'kcal', 'imageUrl', 'imageSourceUrl']);
    const s = v.context.snapshot;
    if (s.name !== null) text(s.name, 200);
    ensure(Array.isArray(s.menu) && s.menu.length <= 100, '메뉴 구성을 확인해 주세요.');
    for (const line of s.menu as unknown[]) text(line, 300);
    for (const key of ['price', 'kcal']) ensure(s[key] === null || (typeof s[key] === 'number' && Number.isFinite(s[key]) && s[key] >= 0), '메뉴 수치가 올바르지 않습니다.');
    for (const key of ['imageUrl', 'imageSourceUrl']) if (s[key] !== null) {
      text(s[key], 2000); ensure(/^(\/[^/]|https?:\/\/)/.test(s[key] as string), '이미지 경로가 올바르지 않습니다.');
    }
  } else if (v.kind === 'person') {
    object(v, [...fields, ...experienceFields, 'event']); ensure(['first-met', 'memory'].includes(v.event as string), '인연 기록 종류가 올바르지 않습니다.');
  } else { ensure(v.kind === 'custom', '지원하지 않는 경험입니다.'); object(v, [...fields, ...experienceFields]); }
}
export function collectInput(input: unknown): CollectCommand {
  object(input, ['ownerId', 'dexId', 'requestId', 'subject', 'entryId', 'experience']);
  id(input.ownerId); id(input.dexId); id(input.requestId); if (input.entryId !== undefined) id(input.entryId);
  subject(input.subject);
  ensure(!!input.experience && typeof input.experience === 'object', '경험 기록이 필요합니다.');
  experienceData(input.experience as ObjectValue, false);
  ensure((input.experience as ObjectValue).kind === input.subject.kind, '카드와 경험의 종류가 다릅니다.');
  const copy = structuredClone(input) as unknown as CollectCommand;
  copy.experience.note ??= '';
  return copy;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  const encoded = JSON.stringify(value);
  ensure(encoded !== undefined, '직렬화할 수 없는 값입니다.');
  return encoded;
}
export async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return 'sha256:v1:' + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function kindFor(s: EntrySubject) { return s.kind === 'person' ? 'people' : s.kind; }

/** 입출력 경계에서 필드·소유 범위·참조·유일성을 함께 검증한다. 손상 기록은 자동 초기화하지 않는다. */
export function validateDocument(value: unknown): asserts value is DexDocument {
  object(value, ['profile', 'dexes', 'entries', 'experiences', 'receipts']);
  object(value.profile, ['id', 'ownerId', 'scope', 'namespace', 'schemaVersion', 'revision', 'createdAt']);
  const p = value.profile;
  ensure(p.id === 'local-profile' && p.scope === 'local-browser' && ['personal','development'].includes(p.namespace as string) && p.schemaVersion === 1, '로컬 프로필 버전을 확인해 주세요.');
  id(p.ownerId); natural(p.revision); instant(p.createdAt);
  for (const key of ['dexes', 'entries', 'experiences', 'receipts']) ensure(Array.isArray(value[key]) && (value[key] as unknown[]).length <= 100000, '기록 배열이 올바르지 않거나 너무 큽니다.');
  const d = value as unknown as DexDocument;
  const unique = (rows: {id: string}[]) => ensure(new Set(rows.map(r => r.id)).size === rows.length, '중복 식별자가 있습니다.');
  const owner = (v: {ownerId: string}) => ensure(v.ownerId === p.ownerId, '로컬 소유 범위가 다릅니다.');
  for (const dex of d.dexes) {
    object(dex, [...base,'ownerId','kind','name','icon','visibility','progress','peopleBoard','peopleBoards']); versioned(dex); owner(dex);
    ensure(['meal','people','custom'].includes(dex.kind) && dex.visibility === 'private', '도감 종류·공개 범위를 확인해 주세요.'); text(dex.name, 80); ensure(ICONS.includes(dex.icon as typeof ICONS[number]), '허용된 아이콘을 사용해 주세요.');
    object(dex.progress, dex.progress?.mode === 'bounded' ? ['mode','targetSetId','targetSetVersion'] : ['mode']);
    if (dex.progress.mode === 'bounded') { id(dex.progress.targetSetId); natural(dex.progress.targetSetVersion, true); }
    else ensure(dex.progress.mode === 'count-only', '진행 표시 정책을 확인해 주세요.');
  }
  for(const dex of d.dexes)if(dex.peopleBoard!==undefined)validatePeopleBoard(dex.peopleBoard,dex,d.entries);
  ensure(d.dexes.filter(dex=>dex.peopleBoards).length<=1,'인연 보드 목록은 하나의 원본 도감에서 관리합니다.');
  if(d.dexes.some(dex=>dex.peopleBoards))ensure(d.dexes.every(dex=>!dex.peopleBoard),'구형·다중 보드 데이터를 혼합할 수 없습니다.');
  for(const dex of d.dexes)if(dex.peopleBoards!==undefined)validateBoardCollection(dex.peopleBoards,dex,d.entries);
  unique(d.dexes); unique(d.entries); unique(d.experiences); unique(d.receipts);
  const dexes = new Map(d.dexes.map(v => [v.id,v]));
  const entries = new Map(d.entries.map(v => [v.id,v]));
  const experiences = new Map(d.experiences.map(v => [v.id,v]));
  const mealKeys: string[] = [];
  for (const entry of d.entries) {
    object(entry, [...base,'ownerId','dexId','subject','firstCollectedAt','collectedOn']); versioned(entry); owner(entry); subject(entry.subject); date(entry.collectedOn); instant(entry.firstCollectedAt); id(entry.dexId);
    ensure(dexes.get(entry.dexId)?.kind === kindFor(entry.subject), '카드의 도감 참조가 올바르지 않습니다.');
    if (entry.subject.kind === 'meal') mealKeys.push(canonical([entry.ownerId, entry.dexId, entry.subject.dishId]));
  }
  ensure(new Set(mealKeys).size === mealKeys.length, '같은 메뉴의 카드가 중복되었습니다.');
  for (const exp of d.experiences) {
    versioned(exp as unknown as ObjectValue); owner(exp); experienceData(exp as unknown as ObjectValue, true);
    id(exp.dexId); id(exp.entryId); id(exp.requestId); text(exp.note,500,true);
    const entry = entries.get(exp.entryId);
    ensure(entry && entry.dexId === exp.dexId && entry.subject.kind === exp.kind, '경험의 카드 참조가 올바르지 않습니다.');
  }
  for (const r of d.receipts) {
    object(r, ['id','ownerId','requestId','dexId','operation','payloadFingerprint','entryId','experienceId','originalEntryWasCreated','committedAt']);
    owner(r); id(r.requestId); id(r.dexId); id(r.entryId); id(r.experienceId); instant(r.committedAt);
    ensure(r.id === canonical([r.ownerId,r.requestId]) && r.operation === 'collect' && /^sha256:v1:[0-9a-f]{64}$/.test(r.payloadFingerprint) && typeof r.originalEntryWasCreated === 'boolean', '요청 영수증이 올바르지 않습니다.');
    const exp = experiences.get(r.experienceId);
    if (exp) ensure(exp.entryId === r.entryId && exp.dexId === r.dexId && exp.requestId === r.requestId, '요청과 경험의 참조가 다릅니다.');
    const entry = entries.get(r.entryId);
    if (entry) ensure(entry.dexId === r.dexId, '요청과 카드의 참조가 다릅니다.');
  }
  const receiptedExperiences = new Set(d.receipts.map(r => r.experienceId));
  for (const exp of d.experiences) ensure(receiptedExperiences.has(exp.id), '경험의 요청 영수증이 없습니다.');
}

export function parseBackup(raw: string): BackupEnvelope {
  try {
    const v: unknown = JSON.parse(raw);
    object(v, ['format','schemaVersion','exportedAt','containsSensitiveData','data']);
    ensure(v.format === 'bokak-dex', 'BOKAK 내보내기 파일이 아닙니다.');
    ensure(v.schemaVersion === 1 || v.schemaVersion === 2 || v.schemaVersion === 3 || v.schemaVersion === 4 || v.schemaVersion === 5 || v.schemaVersion === 6 || v.schemaVersion === 7 || v.schemaVersion === 8 || v.schemaVersion === 9 || v.schemaVersion === 10, '지원하지 않는 백업 버전입니다.', 'UNSUPPORTED_SCHEMA');
    ensure(v.containsSensitiveData === true, '백업 정보가 누락되었습니다.'); instant(v.exportedAt); validateDocument(v.data);
    if(v.schemaVersion===1||v.schemaVersion===2)ensure(v.data.dexes.every(dex=>dex.peopleBoard===undefined),'보드는 v3 백업을 사용해야 합니다.');
    if(v.schemaVersion===3)ensure(v.data.dexes.every(dex=>!dex.peopleBoard||dex.peopleBoard.version===1),'확장 보드는 v4 백업을 사용해야 합니다.');
    if(v.schemaVersion!==1)ensure(v.data.experiences.every(exp=>exp.kind!=='meal'||!!exp.card),'카드 정보가 누락된 v2 백업입니다.');
    if(v.schemaVersion<5)ensure(v.data.dexes.every(dex=>!dex.peopleBoard||dex.peopleBoard.version!==3),'사진 보드는 v5 사진 백업이 필요합니다.');
    if(v.schemaVersion<6)ensure(v.data.dexes.every(dex=>!dex.peopleBoards),'다중 보드는 v6 백업을 사용해야 합니다.');
    if(v.schemaVersion<7)ensure(v.data.entries.every(e=>e.subject.kind!=='person'||!['nickname','trait','tags','avatar','profileAssetId'].some(k=>k in e.subject)),'캐릭터 인연은 v7 백업을 사용해야 합니다.');
    if(v.schemaVersion<8)ensure(v.data.dexes.every(dex=>!dex.peopleBoards?.boards.some(b=>b.layout.version===4)),'자유 연결은 v8 백업이 필요합니다.');
    if(v.schemaVersion<9)ensure(v.data.entries.every(e=>e.subject.kind!=='person'||(e.subject.characterIntro===undefined&&!isCharacterAvatar(e.subject.avatar)&&(e.subject.trait?.length??0)<=100)),'새 소개와 아바타는 v9 백업이 필요합니다.');
    if(v.schemaVersion<10)ensure(v.data.entries.every(e=>!hasPersonDetails(e.subject)),'추가 인연 정보는 v10 백업이 필요합니다.');
    normalizeLegacyCards(v.data);
    return v as unknown as BackupEnvelope;
  } catch (error) {
    if (error instanceof DexError && error.code === 'UNSUPPORTED_SCHEMA') throw error;
    throw new DexError('INVALID_BACKUP', '백업 구조·참조·필드를 확인해 주세요. 기존 기록은 변경하지 않았습니다.');
  }
}

export function experienceDraft(value: ExperienceDraft): ExperienceDraft {
  experienceData(value as unknown as ObjectValue, false); return structuredClone(value);
}
