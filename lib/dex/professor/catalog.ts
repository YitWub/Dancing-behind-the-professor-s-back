import type { CollectionEntry, EntrySubject, Experience } from '../core/types.ts';
export type ProfessorSubject = Extract<EntrySubject,{kind:'professor'}>;
export type ProfessorEntry = CollectionEntry & {subject:ProfessorSubject};
export type CourseExperience = Experience & {kind:'professor'};
export interface Faculty {id:string;name:string;college:string;department:string;sourceUrl?:string;verifiedOn?:string}
export const SEMESTERS = {'1':'1학기',summer:'여름 계절학기','2':'2학기',winter:'겨울 계절학기'} as const;
export type Semester = keyof typeof SEMESTERS;
export function professorSubject(faculty:Faculty):ProfessorSubject {
  return {kind:'professor',professorId:faculty.id,displayName:faculty.name,college:faculty.college,department:faculty.department,...(faculty.sourceUrl?{sourceUrl:faculty.sourceUrl}:{})};
}
export function professorFaculty(subject:ProfessorSubject):Faculty {
  return {id:subject.professorId,name:subject.displayName,college:subject.college,department:subject.department,sourceUrl:subject.sourceUrl};
}
export function normalizeSearch(text:string){return text.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase('ko');}
export function matchesFaculty(faculty:Faculty,search:string,college:string){
  return (!college||faculty.college===college)&&normalizeSearch([faculty.name,faculty.college,faculty.department].join(' ')).includes(normalizeSearch(search));
}
export function courseLabel(exp:Pick<CourseExperience,'academicYear'|'semester'>){return `${exp.academicYear}년 ${SEMESTERS[exp.semester]}`;}
