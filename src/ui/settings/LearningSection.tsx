// Settings → Notifications & shortcuts → Energy check-ins: the way into Energy, the check-in
// reminders that teach eepy your body clock, the natural-wake question, and starting over.
import { router } from 'expo-router';

import { LEARNING } from '../../engine/calibration';
import { pingsPerDay } from '../../engine/pingPlan';
import { ensureNotificationPermission } from '../../notifications/channels';
import { resetLearning } from '../../state/learning';
import { NotificationPrefs, useStore } from '../../state/store';
import { ListCard, ListRow, Section } from '../components';
import { confirm, notify } from '../confirm';
import { ChoiceRow } from './parts';
import { Toggle } from './Toggle';

export function LearningSection() {
  const prefs = useStore((s) => s.settings.notifications);
  const calibration = useStore((s) => s.calibration);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);

  const setNotif = async (patch: Partial<NotificationPrefs>, enabling: boolean) => {
    if (enabling && !(await ensureNotificationPermission())) {
      notify('Notifications are off', 'Allow notifications for eepy in Android settings to get check-in reminders.');
      return;
    }
    setNotificationPrefs(patch);
  };

  const reset = async () => {
    const ok = await confirm(
      'Reset what eepy learned?',
      'eepy forgets your personal body clock and how much each watch signal counts for you, and goes back to the typical forecast. Your check-ins stay in the history but stop counting.',
      'Reset',
      true,
    );
    if (ok) resetLearning();
  };

  const tapered = prefs.pings && pingsPerDay(prefs.pingsPerDay, calibration) === 1;

  return (
    <Section title="Energy check-ins">
      <ListCard>
        <ListRow
          title="Energy"
          sub={calibration?.applied ? `Forecast accuracy ${calibration.accuracy}%` : 'Why the number is what it is, and what eepy has learned'}
          onPress={() => router.push('/energy')}
        />
        <Toggle label="Check-in reminders" sub={'A quick "how alert are you?" that teaches eepy your body clock'} value={prefs.pings} onChange={(v) => setNotif({ pings: v }, v)} />
        {prefs.pings ? (
          <ChoiceRow
            title="How many a day"
            sub={tapered ? 'Down to 1 a day for now: eepy knows your rhythm well' : undefined}
            value={prefs.pingsPerDay}
            onChange={(v) => setNotificationPrefs({ pingsPerDay: v })}
            options={[
              { label: '2 a day', value: 2 },
              { label: '3 a day', value: 3 },
            ]}
            hint={`Morning, afternoon and evening, at varying times. Drops to 1 a day after ${LEARNING.taperCheckins} check-ins over ${LEARNING.taperDays} days.`}
          />
        ) : null}
        <Toggle
          label="Natural-wake question"
          sub={'On free days: "Did you wake up on your own?" Teaches eepy your sleep need'}
          value={prefs.naturalWakePrompt}
          onChange={(v) => setNotif({ naturalWakePrompt: v }, v)}
        />
        <ListRow
          title="Reset what eepy learned"
          sub={calibration ? 'Your body clock and the weight of each watch signal' : 'Nothing learned yet'}
          onPress={calibration ? reset : undefined}
        />
      </ListCard>
    </Section>
  );
}
