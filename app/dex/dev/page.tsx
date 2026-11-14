import { notFound } from 'next/navigation';
import { DevCollectionLab } from '@/components/dex/scaffold/DevCollectionLab';
export default function Page() {
  if(process.env.NODE_ENV!=='development')notFound();
  return <DevCollectionLab/>;
}
