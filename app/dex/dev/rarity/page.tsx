import { notFound } from 'next/navigation';
export default async function Page(){
  if(process.env.NODE_ENV!=='development')notFound();
  const {RarityPreview}=await import('@/components/dex/dev/RarityPreview');
  return <RarityPreview/>;
}
