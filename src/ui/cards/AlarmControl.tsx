/**
 * The next wake alarm as it will actually ring (held this-morning alarm, watch-first buzz + phone
 * backup), with a one-tap "Skip" for a day off and "Undo". Skipping only silences that one morning.
 */
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { dateKey, formatTime } from '@/engine/time';
import { ensureNotificationPermission } from '@/notifications/channels';
import { nextWakeAlarm, WAKE_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { useStore } from '@/state/store';
import { useNow } from '@/state/useAnalysis';
import { Button, Icon, Row } from '@/ui/components';
import { notify } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

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
      <Row gap={space.sm} style={{ marginTop: space.md }}>
        <Icon name="alarm-off" size={18} color={colors.textFaint} />
        <Text style={[font.small, { flex: 1 }]}>eepy's wake alarm is off — use your own, or let eepy ring at the cycle-timed time.</Text>
        <Button small kind="secondary" label="Turn on" onPress={turnOn} />
      </Row>
    );
  }

  const w = nextWakeAlarm(a, settings, now);
  const day = dateKey(w.base);
  const when = dayLabel(day);
  const text = w.wrist.length ? `${when}: watch ${formatTime(w.base)} · phone ${formatTime(w.at)}` : `Alarm ${when.toLowerCase()} at ${formatTime(w.at)}`;
  return (
    <Row gap={space.sm} style={{ marginTop: space.md }}>
      <Icon name={w.skipped ? 'alarm-off' : 'alarm'} size={18} color={w.skipped ? colors.textFaint : colors.energy} />
      <View style={{ flex: 1 }}>
        <Text style={[font.body, w.skipped ? { color: colors.textDim, textDecorationLine: 'line-through' } : null]}>
          {text}
        </Text>
        <Text style={font.tiny}>{w.skipped ? 'Skipped — sleep in. It comes back the morning after.' : 'Day off? Skip just this one.'}</Text>
      </View>
      {w.skipped ? (
        <Button small kind="secondary" icon="undo" label="Undo" onPress={() => setMark(WAKE_SKIP_MARK, undefined)} />
      ) : (
        <Button small kind="secondary" icon="alarm-off" label="Skip" onPress={() => setMark(WAKE_SKIP_MARK, day)} />
      )}
    </Row>
  );
}
