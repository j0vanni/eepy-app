/**
 * The next wake alarm as it will actually ring (held this-morning alarm, watch-first buzz + phone
 * backup), with a one-tap "Skip" for a day off and "Undo". Skipping only silences that one morning.
 * A plain row with no panel of its own: it sits inside a Card (Today's evening, Plan → Tonight).
 */
import type { Analysis } from '@/engine/analysis';
import { dateKey, formatTime } from '@/engine/time';
import { ensureNotificationPermission } from '@/notifications/channels';
import { nextWakeAlarm, WAKE_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, ListRow } from '@/ui/components';
import { notify } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { colors } from '@/ui/theme';

export function AlarmControl({ a }: { a: Analysis }) {
  const now = useNow(60_000);
  const settings = useStore((s) => s.settings);
  const setMark = useStore((s) => s.setMark);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);

  if (!settings.notifications.smartAlarm) {
    const turnOn = async () => {
      if (await ensureNotificationPermission()) setNotificationPrefs({ smartAlarm: true });
      else notify('Notifications are off', 'Allow notifications for eepy in Android settings so the alarm can ring.');
    };
    return (
      <ListRow
        icon="alarm-off"
        iconColor={colors.textFaint}
        title="eepy's alarm is off"
        sub="Use your own, or let eepy ring at the end of a sleep cycle."
        right={<Button small kind="secondary" label="Turn on" onPress={turnOn} />}
      />
    );
  }

  const w = nextWakeAlarm(a, settings, now);
  const day = dateKey(w.base);
  const when = dayLabel(day);
  // Two-step morning: the routine alarm first, then the final one (engine/twoStep.ts).
  const r = w.routine;
  const times = r
    ? w.wrist.length
      ? `routine ⌚ ${formatTime(r.base)} · up ⌚ ${formatTime(w.base)} (phone ${formatTime(w.at)})`
      : `routine ${formatTime(r.at)} · up ${formatTime(w.at)}`
    : w.wrist.length
      ? `watch ${formatTime(w.base)} · phone ${formatTime(w.at)}`
      : undefined;
  if (w.skipped) {
    return (
      <ListRow
        icon="alarm-off"
        iconColor={colors.textFaint}
        title={`No alarm ${when.toLowerCase()}`}
        sub={`Skipped (${times ?? formatTime(w.at)}). It comes back the morning after.`}
        right={<Button small kind="secondary" icon="undo" label="Undo" onPress={() => setMark(WAKE_SKIP_MARK, undefined)} />}
      />
    );
  }
  return (
    <ListRow
      icon="alarm"
      iconColor={colors.energy}
      title={times ? `${when}: ${times}` : `Alarm ${when.toLowerCase()} at ${formatTime(w.at)}`}
      sub="Day off? Skip just this one."
      right={<Button small kind="secondary" icon="alarm-off" label="Skip" onPress={() => setMark(WAKE_SKIP_MARK, day)} />}
    />
  );
}
