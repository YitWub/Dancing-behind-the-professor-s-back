import { AppShell } from '@/components/AppShell';
import { HomeScreen } from '@/components/HomeScreen';
import { toISODate } from '@/components/format';

export default function Page() {
  // 첫 렌더용 날짜. 마운트 직후 보는 사람 시계로 다시 맞춘다.
  return (
    <AppShell
      title="오늘의 에리카"
      subtitle="오늘 해야 할 결정 세 개"
    >
      <HomeScreen initialDate={toISODate(new Date())} />
    </AppShell>
  );
}
