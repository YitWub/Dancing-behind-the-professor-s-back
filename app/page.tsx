import { AppShell } from '@/components/AppShell';
import { HomeScreen } from '@/components/HomeScreen';
import { kstToday } from '@/lib/datetime';

export default function Page() {
  // 첫 렌더용 날짜는 KST 기준이어야 한다 (CONTRACT 9장 — 서버가 UTC 면 오전에 어제가 뜬다).
  // 마운트 직후 보는 사람 시계로 한 번 더 맞춘다.
  return (
    <AppShell
      title="오늘의 에리카"
      subtitle="오늘 해야 할 결정 세 개"
    >
      <HomeScreen initialDate={kstToday()} />
    </AppShell>
  );
}
