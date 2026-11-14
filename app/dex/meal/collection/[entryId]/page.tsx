import { MealEntryDetail } from '@/components/dex/meal/MealEntryDetail';
export default async function Page({params}:{params:Promise<{entryId:string}>}){const {entryId}=await params;return <MealEntryDetail entryId={entryId}/>;}
