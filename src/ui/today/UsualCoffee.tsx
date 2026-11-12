/** "Had your usual coffee?" — asked when the usual morning drink hasn't been logged an hour after its time. */
import { router } from 'expo-router';
import { Text } from 'react-native';

import { USUAL_SKIPPED_MARK, usualCaffeine, usualCaffeineMissing, usualDose } from '@/engine/caffeineHabits';
import { dateKey, formatClock } from '@/engine/time';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Card, Row } from '@/ui/components';
import { font, space } from '@/ui/theme';

const shortDrink = (label: string) => label.replace(/\s*\(.*\)/, '');

export function UsualCoffee() {
  const now = useNow(60_000);
  const doses = useStore((s) => s.caffeine);
  const skipped = useStore((s) => s.settings.marks[USUAL_SKIPPED_MARK]);
  const addCaffeine = useStore((s) => s.addCaffeine);
  const setMark = useStore((s) => s.setMark);
  const usual = usualCaffeine(doses, now);
  if (!usual || skipped === dateKey(now) || !usualCaffeineMissing(doses, now, usual)) return null;
  return (
    <Card>
      <Text style={font.h3}>Had your usual coffee?</Text>
      <Text style={[font.small, { marginTop: 2 }]}>
        You usually have a {shortDrink(usual.label).toLowerCase()} around {formatClock(usual.timeMin)}. Logging it keeps your energy and cut-off right.
      </Text>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        <Button
          small
          icon="check"
          label={`Yes, at ${formatClock(usual.timeMin)}`}
          onPress={() => {
            const dose = usualDose(usual, Date.now());
            if (!useStore.getState().caffeine.some((d) => d.id === dose.id)) addCaffeine(dose);
          }}
        />
        <Button small kind="secondary" label="Other time" onPress={() => router.push({ pathname: '/caffeine', params: { usual: '1' } })} />
        <Button small kind="ghost" label="Not today" onPress={() => setMark(USUAL_SKIPPED_MARK, dateKey(Date.now()))} />
      </Row>
    </Card>
  );
}
