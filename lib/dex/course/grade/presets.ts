export const ERICA_POLICY_SOURCE = 'https://site.hanyang.ac.kr/web/ehaksa/-grade-process';
export const ERICA_RELATIVE_PRESETS = {
  relative1: { label: '상대평가 1', aCap: 30, abCap: 70 },
  relative2: { label: '상대평가 2', aCap: 40, abCap: 80 },
  relative3: { label: '상대평가 3', aCap: 50, abCap: 90 },
} as const;
// IDs refer to the published table checked on 2026-11-19.
export type RelativePreset = keyof typeof ERICA_RELATIVE_PRESETS | 'unknown';

export function isRelativePreset(value: unknown): value is RelativePreset {
  return typeof value === 'string' && (value === 'unknown' || Object.hasOwn(ERICA_RELATIVE_PRESETS, value));
}

export function ericaPreset(value?: RelativePreset) {
  return value && value !== 'unknown' ? ERICA_RELATIVE_PRESETS[value] : undefined;
}
