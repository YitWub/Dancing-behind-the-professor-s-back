import { MealEntryDetail } from '@/components/dex/meal/MealEntryDetail';
export default async function Page({params,searchParams}:{params:Promise<{entryId:string}>;searchParams:Promise<{experience?:string}>}){const {entryId}=await params;const {experience}=await searchParams;return <MealEntryDetail key={entryId+':'+(experience??'')} entryId={entryId} initialExperienceId={experience}/>;}
