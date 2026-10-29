// OWNER: learning workstream. Settings: alertness pings, natural-wake prompt, reset learned rhythm.
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { LEARNING } from '../../engine/calibration';
import { pingsPerDay } from '../../engine/pingPlan';
import { ensureNotificationPermission } from '../../notifications/channels';
import { resetLearning } from '../../state/learning';
import { NotificationPrefs, useStore } from '../../state/store';
import { Button, Card, ListRow, Section, Segmented } from '../components';
import { confirm, notify } from '../confirm';
import { font, space } from '../theme';
import { Toggle } from './Toggle';

export function LearningSection() {
  const prefs = useStore((s) => s.settings.notifications);
  const calibration = useStore((s) => s.calibration);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);

  const setNotif = async (patch: Partial<NotificationPrefs>, enabling: boolean) => {
    if (enabling && !(await ensureNotificationPermission())) {
      notify('Notifications are off', 'Allow notifications for eepy in Android settings to get check-in pings.');
      return;
    }
    setNotificationPrefs(patch);
  };

  const reset = async () => {
    const ok = await confirm(
      'Reset learned rhythm?',
      'eepy forgets your personal body clock and goes back to the average-person forecast. Your check-ins stay in the history but stop counting toward the fit.',
      'Reset',
      true,
    );
    if (ok) resetLearning();
  };

  const tapered = prefs.pings && pingsPerDay(prefs.pingsPerDay, calibration) === 1;

  return (
    <Section title="Learning your rhythm">
      <Card>
        <Toggle
          label="Alertness check-in pings"
          sub="Quick 'how alert are you?' notifications that teach eepy your body clock"
          value={prefs.pings}
          onChange={(v) => setNotif({ pings: v }, v)}
        />
        {prefs.pings ? (
          <View style={{ marginBottom: space.sm }}>
            <Segmented
              value={prefs.pingsPerDay}
              onChange={(v) => setNotificationPrefs({ pingsPerDay: v })}
              options={[
                { label: '2 a day', value: 2 },
                { label: '3 a day', value: 3 },
              ]}
            />
            <Text style={[font.tiny, { marginTop: 4 }]}>
              {tapered
                ? 'Your rhythm is well calibrated, so it\'s down to 1 a day to keep it current.'
                : `Morning, afternoon and evening, at varying times. Drops to 1 a day after ${LEARNING.taperCheckins} check-ins over ${LEARNING.taperDays} days.`}
            </Text>
          </View>
        ) : null}
        <Toggle
          label="Natural-wake question"
          sub="On free days: 'Did you wake up on your own?' — teaches your sleep need"
          value={prefs.naturalWakePrompt}
          onChange={(v) => setNotif({ naturalWakePrompt: v }, v)}
        />
        <ListRow icon="brain" title="Your body clock" sub={calibration?.applied ? `Forecast accuracy ${calibration.accuracy}%` : 'See what eepy has learned so far'} onPress={() => router.push('/learning')} />
        <Button small kind="danger" icon="restore" label="Reset learned rhythm" onPress={reset} disabled={!calibration} />
      </Card>
    </Section>
  );
}
