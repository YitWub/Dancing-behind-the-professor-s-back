import type {EntrySubject} from '../core/types.ts';
export const MBTI_TYPES=['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP','ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'] as const;
export const GENDER_LABELS={male:'남성',female:'여성',other:'기타'} as const;
export const ENERGY_LABELS={egen:'에겐',teto:'테토'} as const;
export type PersonGender=keyof typeof GENDER_LABELS;
export type PersonMbti=typeof MBTI_TYPES[number];
export type PersonEnergy=keyof typeof ENERGY_LABELS;
export const PERSON_DETAIL_FIELDS=['age','gender','mbti','energyType'] as const;
export function hasPersonDetails(subject:EntrySubject){return subject.kind==='person'&&PERSON_DETAIL_FIELDS.some(k=>subject[k]!==undefined);}
