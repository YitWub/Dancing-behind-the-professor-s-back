import { notFound } from 'next/navigation';
export default async function Page(){
  if(process.env.NODE_ENV!=='development')notFound();
  const {DeveloperToolsHub}=await import('@/components/dex/dev/DeveloperToolsHub');
  return <DeveloperToolsHub/>;
}
