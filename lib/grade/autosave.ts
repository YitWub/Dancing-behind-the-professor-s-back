import type { ManagedCourse } from './management-types.ts';
import { assignmentChangeMessages } from './assignments.ts';
import { estimateChangeMessages } from './attendance-estimate.ts';
import { isSafeAttendanceSelectionChange } from './attendance-link.ts';

export function autoSaveChanges(before:ManagedCourse,after:ManagedCourse) {
  const assignments=assignmentChangeMessages([before],[after]);
  const attendance=estimateChangeMessages([before],[after]);
  const withoutCounts=(c:ManagedCourse)=>c.attendanceEstimate?{...c.attendanceEstimate,absences:0,lateness:0}:null;
  const simpleCounts=!!before.attendanceEstimate&&!!after.attendanceEstimate&&JSON.stringify(withoutCounts(before))===JSON.stringify(withoutCounts(after));
  return {assignments:assignments.length>0,attendance:attendance.length>0,messages:[...assignments,...(simpleCounts||isSafeAttendanceSelectionChange(before,after)?[]:attendance)]};
}

export const draftKey=(id:string)=>`erica.grade.editor-draft.v1.${id}`;
// Preserve incomplete numeric fields (NaN), rather than turning them into valid zeroes.
export const encodeDraft=(value:unknown)=>JSON.stringify(value,(_k,v)=>typeof v==='number'&&!Number.isFinite(v)?{$invalidNumber:true}:v);
export function writeEditorDraft(id:string,base:ManagedCourse,draft:unknown):boolean {
  try{window.localStorage.setItem(draftKey(id),encodeDraft({base:JSON.stringify(base),draft}));return true;}catch{return false;}
}
export function readEditorDraft<T>(id:string,base:ManagedCourse,valid:(value:unknown)=>value is T):T|null {
  try{const raw=window.localStorage.getItem(draftKey(id));if(!raw)return null;const value=JSON.parse(raw,(_k,v)=>v&&typeof v==='object'&&v.$invalidNumber===true?NaN:v);return value.base===JSON.stringify(base)&&valid(value.draft)?value.draft:null;}catch{return null;}
}
export function removeEditorDraft(id:string){try{window.localStorage.removeItem(draftKey(id));}catch{/* The official v2 save remains authoritative. */}}

/** One synchronous localStorage writer, newest revision only; injectable clock for tests. */
export function createAutoSaveQueue(clock:{set:(fn:()=>void,delay:number)=>unknown;clear:(id:unknown)=>void}) {
  let timer:unknown,job:(()=>void)|null=null;
  const cancel=()=>{if(timer!==undefined)clock.clear(timer);timer=undefined;job=null;};
  const flush=()=>{const latest=job;cancel();latest?.();};
  return {cancel,flush,schedule(fn:()=>void,delay:number){cancel();job=fn;timer=clock.set(flush,delay);}};
}
