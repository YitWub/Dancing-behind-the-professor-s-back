import type { CollectionEntry, DexDocument, Experience, Rating } from '../core/types.ts';

export type MealExperience=Extract<Experience,{kind:'meal'}>;
export function mealExperiences(doc:DexDocument,entryId:string):MealExperience[] {
  return doc.experiences.filter((e):e is MealExperience=>e.entryId===entryId&&e.kind==='meal')
    .sort((a,b)=>b.experiencedOn.localeCompare(a.experiencedOn)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
}
export interface MealCardSummary {entry:CollectionEntry;name:string;experiences:MealExperience[];rating:Rating|null;note:string|null;imageUrl:string|null;imageSourceUrl:string|null}
export function mealCards(doc:DexDocument):MealCardSummary[] {
  return doc.entries.filter(e=>e.subject.kind==='meal').map(entry=>{
    const experiences=mealExperiences(doc,entry.id);
    const photo=experiences.find(e=>e.context.snapshot.imageUrl||e.context.snapshot.imageSourceUrl)?.context.snapshot;
    return {entry,name:entry.subject.kind==='meal'?entry.subject.displayNameSnapshot:'',experiences,
      rating:experiences.find(e=>e.rating!==null)?.rating??null,note:experiences.find(e=>e.note.trim())?.note??null,
      imageUrl:photo?.imageUrl??null,imageSourceUrl:photo?.imageSourceUrl??null};
  }).sort((a,b)=>b.entry.createdAt.localeCompare(a.entry.createdAt)||a.name.localeCompare(b.name));
}
