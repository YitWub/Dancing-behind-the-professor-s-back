import { AppShell } from '@/components/AppShell';
import { MealScreen } from '@/components/meal/MealScreen';
import { toISODate } from '@/components/format';

export default function Page() {
  return (
    <AppShell
      title="오늘 뭐 먹지"
      subtitle="학식 · 창보 식단과 오늘의 대결"
    >
      <MealScreen initialDate={toISODate(new Date())} />
    </AppShell>
  );
}
