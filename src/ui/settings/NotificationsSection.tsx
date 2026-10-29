// OWNER: background & notifications workstream (new toggles for background sync, morning report, …).
import { Card, Section } from '../components';
import { notify } from '../confirm';
import { ensureNotificationPermission } from '../../notifications/channels';
import { NotificationPrefs, useStore } from '../../state/store';
import { Toggle } from './Toggle';

export function NotificationsSection() {
  const profile = useStore((s) => s.profile);
  const settings = useStore((s) => s.settings);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);

  const setNotif = async (key: keyof NotificationPrefs, value: boolean) => {
    if (value && !(await ensureNotificationPermission())) {
      notify('Notifications are off', 'Allow notifications for eepy in Android settings to get reminders and alarms.');
      return;
    }
    setNotificationPrefs({ [key]: value });
  };

  return (
    <Section title="Notifications">
      <Card>
        <Toggle label="Wind-down reminder" sub={`${profile.windDownMin} min before lights out`} value={settings.notifications.windDown} onChange={(v) => setNotif('windDown', v)} />
        <Toggle label="Bedtime" value={settings.notifications.bedtime} onChange={(v) => setNotif('bedtime', v)} />
        <Toggle label="Caffeine cut-off" value={settings.notifications.caffeine} onChange={(v) => setNotif('caffeine', v)} />
        <Toggle label="Morning check-in" value={settings.notifications.morningCheckIn} onChange={(v) => setNotif('morningCheckIn', v)} />
        <Toggle
          label="Wake alarm (cycle-timed)"
          sub="Rings at the end of a predicted sleep cycle before your wake time"
          value={settings.notifications.smartAlarm}
          onChange={(v) => setNotif('smartAlarm', v)}
        />
      </Card>
    </Section>
  );
}
