/**
 * Paying back sleep debt: how the coming nights each add a little, instead of one long lie-in.
 * A folded row on the Plan tab and in the month view; shown from one hour of debt.
 */
import { Text, View } from 'react-native';

import { addDays, formatDuration, formatTime } from '@/engine/time';
import type { UpcomingNight } from '@/engine/weekPlan';
import { Fold, KeyValue } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

/** Under an hour of debt there is nothing to pay back. */
export const hasRecovery = (debtMin: number) => debtMin >= 60;

/** "Tonight", "Tomorrow night", "Wed 4 Nov night" for the night before a morning. */
function nightName(wakeDate: string): string {
  const d = dayLabel(addDays(wakeDate, -1));
  return d === 'Today' ? 'Tonight' : `${d} night`;
}

/** The folded row. `bare` for use inside a list panel. Renders nothing under an hour of debt. */
export function RecoveryFold({ nights, debtMin, bare }: { nights: UpcomingNight[]; debtMin: number; bare?: boolean }) {
  if (!hasRecovery(debtMin)) return null;
  const paying = nights.filter((n) => n.extraForDebtMin > 0).slice(0, 4);
  const clear = nights.find((n) => n.debtAfterMin < 60);
  return (
    <Fold bare={bare} icon="battery-charging-medium" title="Paying back sleep debt" sub={`You are ${formatDuration(debtMin)} short`}>
      <Text style={font.small}>Instead of one long lie-in, eepy adds a little to the next nights (at most 30 min each) and keeps your wake-ups steady.</Text>
      {paying.length ? (
        <View style={{ marginTop: space.xs }}>
          {paying.map((n) => (
            <KeyValue key={n.wakeDate} label={nightName(n.wakeDate)} sub={`Lights out ${formatTime(n.bedtime)}`} value={`+${n.extraForDebtMin} min`} color={colors.good} />
          ))}
        </View>
      ) : null}
      <Text style={[font.small, { marginTop: space.sm }]}>
        {clear ? `Under 1 h by ${dayLabel(clear.wakeDate).toLowerCase()} morning if you follow the plan.` : 'It keeps shrinking over the next two weeks if you follow the plan.'}
      </Text>
    </Fold>
  );
}
