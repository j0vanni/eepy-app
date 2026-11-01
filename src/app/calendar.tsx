/**
 * Month view (Planner → Month view): past nights and coming mornings for any month, with the same
 * day editor as the Planner (usual / set a time / free day) for mornings beyond this week.
 * Param `date` selects a day.
 */
import { router, useLocalSearchParams } from 'expo-router';

import { useAnalysis } from '@/state/useAnalysis';
import { Button, Empty, Screen } from '@/ui/components';
import { CalendarView, RecoveryCard } from '@/ui/planner/calendar';

export default function CalendarScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ date?: string }>();

  if (!a) {
    return (
      <Screen>
        <Empty icon="calendar-month" title="No nights yet" body="Your calendar fills in as nights arrive from your watch. You can already set your usual workdays and wake-up times in the Planner.">
          <Button label="Open the Planner" icon="calendar-clock" kind="secondary" onPress={() => router.navigate({ pathname: '/planner', params: { show: 'week' } })} />
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen>
      <CalendarView a={a} initialDate={params.date} />
      <RecoveryCard nights={a.upcoming} debtMin={a.debt.debtMin} />
    </Screen>
  );
}
