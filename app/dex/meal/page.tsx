import { connection } from 'next/server';
import { kstToday } from '@/lib/datetime';
import { MealExplore } from '@/components/dex/meal/MealExplore';
export default async function Page({searchParams}:{searchParams:Promise<{view?:string}>}){await connection();const {view}=await searchParams;return <MealExplore initialDate={kstToday()} initialTab={view==='discover'?'discover':'collection'}/>;}
