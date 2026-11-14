import { notFound } from 'next/navigation';
export default async function Page(){
  if(process.env.NODE_ENV!=='development')notFound();
  const {CollectionPreviewLab}=await import('@/components/dex/dev/CollectionPreviewLab');
  return <CollectionPreviewLab/>;
}
