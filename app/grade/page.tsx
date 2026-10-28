import { AppShell } from '@/components/AppShell';
import { GradeScreen } from '@/components/grade/GradeScreen';

export default function Page() {
  return (
    <AppShell
      title="학점 잔고"
      subtitle="째도 되는지, 째면 뭐가 얼마나 움직이는지"
    >
      <GradeScreen />
    </AppShell>
  );
}
