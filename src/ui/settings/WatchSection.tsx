/**
 * The CMF Watch beyond Health Connect: Nothing X mirrors eepy's notifications to the watch, so
 * nap and wake alarms can buzz the wrist silently first, with the phone alarm only as a backup.
 */
import { Linking, Platform, Text, View } from 'react-native';

import { sendWatchTestBuzz } from '../../notifications/alarms';
import { useStore, WatchSettings } from '../../state/store';
import { Button, Card, CardTitle, Note, Row, Section, Segmented } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { colors, font, space } from '../theme';

const NOTHING_X = 'com.nothing.smartcenter';
const ALARM_STYLES: { label: string; value: WatchSettings['napAlarm'] }[] = [
  { label: 'Phone alarm', value: 'phone' },
  { label: 'Watch first', value: 'wrist' },
];

function openNothingX() {
  Linking.openURL(`market://details?id=${NOTHING_X}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${NOTHING_X}`));
}

function Steps({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 6, marginTop: space.sm }}>
      {items.map((t, i) => (
        <Row key={t} gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Text style={[font.small, { color: colors.accent, fontWeight: '700', width: 16 }]}>{i + 1}</Text>
          <Text style={[font.small, { flex: 1 }]}>{t}</Text>
        </Row>
      ))}
    </View>
  );
}

export function WatchSection() {
  const watch = useStore((s) => s.settings.watch);
  const smartAlarm = useStore((s) => s.settings.notifications.smartAlarm);
  const setWatch = useStore((s) => s.setWatchSettings);
  const wristAny = watch.napAlarm === 'wrist' || watch.wakeAlarm === 'wrist';

  const test = async () => {
    if (Platform.OS !== 'android') {
      notify('Android only', 'Watch buzzes need the eepy APK on your phone.');
      return;
    }
    if (await sendWatchTestBuzz()) setWatch({ testSentAt: Date.now() });
    else notify('Notifications are off', 'Allow notifications for eepy in Android settings first.');
  };

  return (
    <Section title="CMF Watch">
      <Card>
        <CardTitle icon="watch-variant" title="Alarms on your wrist" />
        <Text style={font.small}>
          The CMF Watch 3 Pro can't run other apps, but Nothing X shows eepy's notifications on it. Watch-first alarms use that: the watch buzzes silently three times, one minute
          apart, and the phone alarm rings only if you haven't tapped "I'm up" — handy next to a sleeping partner.
        </Text>

        <Text style={[font.body, { marginTop: space.md, marginBottom: 6 }]}>Nap alarm</Text>
        <Segmented options={ALARM_STYLES} value={watch.napAlarm} onChange={(napAlarm) => setWatch({ napAlarm })} />
        <Text style={[font.body, { marginTop: space.md, marginBottom: 6 }]}>Morning alarm</Text>
        <Segmented options={ALARM_STYLES} value={watch.wakeAlarm} onChange={(wakeAlarm) => setWatch({ wakeAlarm })} />
        {watch.wakeAlarm === 'wrist' && !smartAlarm ? <Text style={[font.tiny, { marginTop: 4 }]}>Turn on "Wake alarm" under Notifications for the morning buzz.</Text> : null}

        {wristAny ? (
          <>
            <Text style={[font.body, { marginTop: space.md, marginBottom: 6 }]}>Phone backup after</Text>
            <Segmented
              options={[3, 5, 10].map((m) => ({ label: `${m} min`, value: m }))}
              value={watch.backupMin}
              onChange={(backupMin) => setWatch({ backupMin })}
            />
            <Note tone="warn" icon="sleep">
              If the watch is in Do Not Disturb or sleep mode it won't vibrate — the phone backup still rings. Check the watch's DND schedule in Nothing X.
            </Note>
          </>
        ) : null}
      </Card>

      <Card>
        <CardTitle icon="bell-ring-outline" title="Set up watch notifications" />
        <Steps
          items={[
            'Open Nothing X → your CMF Watch 3 Pro → Notifications, and turn on eepy.',
            'If Android asks, allow Nothing X "Notification access".',
            'Tap "Send test buzz" below — the watch should vibrate and show "eepy test buzz".',
          ]}
        />
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
          <Button small icon="vibrate" label="Send test buzz" onPress={test} />
          <Button small kind="secondary" icon="open-in-new" label="Open Nothing X" onPress={openNothingX} />
        </Row>
        {watch.testSentAt ? <Text style={[font.tiny, { marginTop: 6 }]}>Test sent {relativeTime(watch.testSentAt)}. No buzz? Re-check step 1 and that the watch is connected.</Text> : null}
      </Card>

      <Card>
        <CardTitle icon="music-note-outline" title="Also on the watch" />
        <Text style={font.small}>
          • Sleep sounds show up in the watch's music controls — pause or stop the noise from your wrist without unlocking the phone.{'\n'}• Alertness pings, the morning report and
          reminders buzz the watch too; tap them on the phone to answer.{'\n'}• Sleep, heart rate, HRV, SpO₂ and steps come from the watch through Health Connect (Settings → Data
          sources).
        </Text>
      </Card>
    </Section>
  );
}
