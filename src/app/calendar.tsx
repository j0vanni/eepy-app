/**
 * Month view (Plan → Month view): past nights and coming mornings for any month, with the same day
 * editor as the Plan tab (usual / set a time / free day) for mornings beyond this week.
 * Param `date` selects a day.
 */
import { router, useLocalSearchParams } from 'expo-router';

import { useAnalysis } from '@/state/useAnalysis';
import { Button, Empty, Screen, Section } from '@/ui/components';
import { CalendarView } from '@/ui/planner/calendar';
import { hasRecovery, RecoveryFold } from '@/ui/planner/Recovery';

export default function CalendarScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ date?: string }>();

  if (!a) {
    return (
      <Screen>
        <Empty icon="calendar-month" title="No nights yet" body="The month fills in as nights arrive from your watch. You can already set your workdays and wake-up times on the Plan tab.">
          <Button label="Set your usual week" icon="calendar-clock" kind="secondary" onPress={() => router.navigate({ pathname: '/planner', params: { show: 'week' } })} />
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen>
      <CalendarView a={a} initialDate={params.date} />
      {hasRecovery(a.debt.debtMin) ? (
        <Section title="Sleep debt">
          <RecoveryFold nights={a.upcoming} debtMin={a.debt.debtMin} />
        </Section>
      ) : null}
    </Screen>
  );
}
