import { notFound } from 'next/navigation';
export default async function Page(){
  if(process.env.NODE_ENV!=='development')notFound();
  const {DesignPreviewLab}=await import('@/components/dex/dev/DesignPreviewLab');
  return <DesignPreviewLab/>;
}
