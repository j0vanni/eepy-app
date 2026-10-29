// OWNER: background & notifications workstream.
import { useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';

import { BACKGROUND_INTERVAL_MIN, getBackgroundSyncStatus } from '../../background/task';
import { getPermissionState, healthConnectStatus, requestHealthPermissions } from '../../integrations/healthConnect';
import { ensureNotificationPermission } from '../../notifications/channels';
import { NotificationPrefs, useStore } from '../../state/store';
import { Button, Card, CardTitle, Note, Section } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { font, space } from '../theme';
import { Toggle } from './Toggle';

/** Whether Health Connect lets eepy read while closed: undefined = unknown / not applicable. */
function useBackgroundReadAllowed(enabled: boolean): [boolean | undefined, (v: boolean | undefined) => void] {
  const [allowed, setAllowed] = useState<boolean | undefined>();
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) {
      setAllowed(undefined);
      return;
    }
    let cancelled = false;
    (async () => {
      if ((await healthConnectStatus()) !== 'available') return undefined;
      return (await getPermissionState()).background;
    })()
      .then((v) => !cancelled && setAllowed(v))
      .catch(() => !cancelled && setAllowed(undefined));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return [allowed, setAllowed];
}

export function NotificationsSection() {
  const profile = useStore((s) => s.profile);
  const settings = useStore((s) => s.settings);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);
  const setBackground = useStore((s) => s.setBackground);
  const live = settings.dataMode === 'live';
  const bg = settings.background;
  const [bgAllowed, setBgAllowed] = useBackgroundReadAllowed(live && bg.enabled);
  const [tasksAvailable, setTasksAvailable] = useState<boolean>();

  useEffect(() => {
    if (Platform.OS === 'web') return;
    getBackgroundSyncStatus()
      .then((s) => setTasksAvailable(s.available))
      .catch(() => setTasksAvailable(undefined));
  }, [bg.enabled]);

  const setNotif = async (key: keyof NotificationPrefs, value: boolean) => {
    if (value && !(await ensureNotificationPermission())) {
      notify('Notifications are off', 'Allow notifications for eepy in Android settings to get reminders and alarms.');
      return;
    }
    setNotificationPrefs({ [key]: value });
  };

  const allowBackground = async () => {
    try {
      const p = await requestHealthPermissions();
      setBgAllowed(p.background);
      if (!p.background) {
        notify('Still off', 'In Health Connect, open App permissions → eepy and turn on "Access data in the background". Older Health Connect versions may not offer it yet.');
      }
    } catch (e) {
      notify('Health Connect', e instanceof Error ? e.message : String(e));
    }
  };

  let status: string;
  if (Platform.OS !== 'android') status = 'Background sync runs in the Android app.';
  else if (!bg.enabled) status = 'Off — eepy only syncs when you open it.';
  else if (!live) status = 'Paused while demo data is loaded.';
  else if (tasksAvailable === false) status = "Background tasks aren't available in this build (Expo Go?) — use the APK.";
  else if (bg.lastRun) status = `Last run ${relativeTime(bg.lastRun)} · ${bg.lastResult ?? 'done'}`;
  else status = `Hasn't run yet — Android runs it at most every ${BACKGROUND_INTERVAL_MIN} min while the phone is online and eepy is closed.`;

  return (
    <Section title="Notifications">
      <Card>
        <Toggle label="Wind-down reminder" sub={`${profile.windDownMin} min before lights out`} value={settings.notifications.windDown} onChange={(v) => setNotif('windDown', v)} />
        <Toggle
          label="Live wind-down card"
          sub="Pinned checklist from wind-down until lights out (replaces the plain wind-down reminder)"
          value={settings.notifications.liveWindDown}
          onChange={(v) => setNotif('liveWindDown', v)}
        />
        <Toggle label="Bedtime" value={settings.notifications.bedtime} onChange={(v) => setNotif('bedtime', v)} />
        <Toggle label="Caffeine cut-off" value={settings.notifications.caffeine} onChange={(v) => setNotif('caffeine', v)} />
        <Toggle label="Morning check-in" value={settings.notifications.morningCheckIn} onChange={(v) => setNotif('morningCheckIn', v)} />
        <Toggle
          label="Wake alarm (cycle-timed)"
          sub="Rings at the end of a predicted sleep cycle before your wake time"
          value={settings.notifications.smartAlarm}
          onChange={(v) => setNotif('smartAlarm', v)}
        />
        <Toggle
          label="Adaptive reminders"
          sub="Nap nudge when you need one, caffeine last call only on days you log caffeine, quiet during naps, lights-out moved after a long nap — at most 5 a day"
          value={settings.notifications.adaptiveReminders}
          onChange={(v) => setNotif('adaptiveReminders', v)}
        />
      </Card>
      <Card>
        <CardTitle icon="sync" title="While eepy is closed" />
        <Toggle
          label="Background sync"
          sub="Pulls new nights from Health Connect and refreshes reminders"
          value={bg.enabled}
          onChange={(v) => setBackground({ enabled: v })}
        />
        <Text style={[font.small, { marginBottom: space.sm }]}>{status}</Text>
        {bg.enabled && live && bgAllowed === false ? (
          <>
            <Note tone="warn">Health Connect only lets eepy read your data while it's open, until you allow background access.</Note>
            <Button small icon="shield-check-outline" label="Allow background sync in Health Connect" onPress={allowBackground} />
          </>
        ) : null}
        <Toggle
          label="Morning report"
          sub="Last night's sleep, score and debt as soon as it syncs, plus today's nap and bedtime"
          value={settings.notifications.morningReport}
          onChange={(v) => setNotif('morningReport', v)}
        />
        <Toggle
          label="Missing-night nudge"
          sub="Around 10:00 if last night hasn't arrived from Nothing X"
          value={settings.notifications.missingNightNudge}
          onChange={(v) => setNotif('missingNightNudge', v)}
        />
      </Card>
    </Section>
  );
}
