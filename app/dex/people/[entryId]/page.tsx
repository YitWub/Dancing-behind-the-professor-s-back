import { PersonDetail } from '@/components/dex/people/PersonDetail';
export default async function Page({params}:{params:Promise<{entryId:string}>}){const {entryId}=await params;return <PersonDetail key={entryId} entryId={entryId}/>;}
