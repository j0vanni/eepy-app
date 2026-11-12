/**
 * Settings → Alarms & watch: the CMF Watch beyond Health Connect. Nothing X mirrors eepy's
 * notifications to the watch, so nap and wake alarms can buzz the wrist silently first, with the
 * phone alarm only as a backup.
 */
import { Linking, Platform } from 'react-native';

import { sendWatchTestBuzz } from '../../notifications/alarms';
import { useStore, WatchSettings } from '../../state/store';
import { Fold, ListCard, ListRow, Note, Section } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { Choice, ChoiceRow, Para, Steps } from './parts';

const NOTHING_X = 'com.nothing.smartcenter';
const ALARM_STYLES: Choice<WatchSettings['napAlarm']>[] = [
  { label: 'Phone alarm', value: 'phone' },
  { label: 'Watch first', value: 'wrist' },
];

function openNothingX() {
  Linking.openURL(`market://details?id=${NOTHING_X}`).catch(() => Linking.openURL(`https://play.google.com/store/apps/details?id=${NOTHING_X}`));
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
    <>
      <Section title="Alarms on your wrist">
        <ListCard>
          <ChoiceRow title="Nap alarm" value={watch.napAlarm} options={ALARM_STYLES} onChange={(napAlarm) => setWatch({ napAlarm })} />
          <ChoiceRow
            title="Morning alarm"
            sub={watch.wakeAlarm === 'wrist' && !smartAlarm ? 'Turn on "Wake alarm" above for the morning buzz' : undefined}
            value={watch.wakeAlarm}
            options={ALARM_STYLES}
            onChange={(wakeAlarm) => setWatch({ wakeAlarm })}
          />
          {wristAny ? (
            <ChoiceRow title="Phone backup after" value={watch.backupMin} options={[3, 5, 10].map((m) => ({ label: `${m} min`, value: m }))} onChange={(backupMin) => setWatch({ backupMin })} />
          ) : null}
          <Fold bare title="What Watch first does">
            <Para first>The watch buzzes silently three times, a minute apart. The phone only rings if you haven't tapped "I'm up". Handy next to a sleeping partner.</Para>
          </Fold>
        </ListCard>
        {wristAny ? (
          <Note tone="warn" icon="sleep">
            A watch in Do Not Disturb or sleep mode won't vibrate. The phone backup still rings. Check the watch's DND schedule in Nothing X.
          </Note>
        ) : null}
      </Section>

      <Section title="Watch notifications">
        <ListCard>
          <ListRow
            icon="vibrate"
            title="Send test buzz"
            sub={watch.testSentAt ? `Sent ${relativeTime(watch.testSentAt)}. No buzz? Check step 1 and that the watch is connected.` : 'The watch should vibrate and show "eepy test buzz"'}
            onPress={test}
          />
          <ListRow icon="open-in-new" title="Open Nothing X" onPress={openNothingX} />
          <Fold bare title="How to set it up">
            <Steps
              items={[
                'Open Nothing X → your CMF Watch 3 Pro → Notifications, and turn on eepy.',
                'If Android asks, allow Nothing X "Notification access".',
                'Tap "Send test buzz" above.',
              ]}
            />
          </Fold>
          <Fold bare title="Also on the watch">
            <Para first>Sleep sounds appear in the watch’s music controls: pause them from your wrist.</Para>
            <Para>Check-in reminders, the morning report and other reminders buzz the watch too. Answer them on the phone.</Para>
            <Para>Sleep, heart rate, HRV, blood oxygen and steps come from the watch through Health Connect (Settings → Watch and data).</Para>
          </Fold>
        </ListCard>
      </Section>
    </>
  );
}
