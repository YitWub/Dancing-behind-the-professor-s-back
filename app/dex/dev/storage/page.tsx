import Link from 'next/link';
import { notFound } from 'next/navigation';
export default async function Page(){
  if(process.env.NODE_ENV!=='development')notFound();
  const {DevCollectionLab}=await import('@/components/dex/scaffold/DevCollectionLab');
  return <div className="space-y-4"><Link href="/dex/dev" className="dex-back">← 개발자 도구</Link><DevCollectionLab/></div>;
}
