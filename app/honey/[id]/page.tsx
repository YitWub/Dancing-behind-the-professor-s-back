import { AppShell } from '@/components/AppShell';
import { LectureDetail } from '@/components/honey/LectureDetail';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell title="강의 상세" back={{ href: '/honey', label: '꿀강 탐색' }}>
      <LectureDetail id={id} />
    </AppShell>
  );
}
