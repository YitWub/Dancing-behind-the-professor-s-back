import { AppShell } from '@/components/AppShell';
import { HoneyScreen } from '@/components/honey/HoneyScreen';

export default function Page() {
  return (
    <AppShell
      title="꿀강 탐색"
      subtitle="점수보다 먼저, 그 점수를 믿어도 되는지"
    >
      <HoneyScreen />
    </AppShell>
  );
}
