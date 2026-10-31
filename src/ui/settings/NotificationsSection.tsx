// OWNER: background & notifications workstream.
import { useEffect, useState } from 'react';
import { AppState, Platform, Text, View } from 'react-native';

import { BACKGROUND_INTERVAL_MIN, getBackgroundSyncStatus } from '../../background/task';
import { getPermissionState, healthConnectStatus, requestHealthPermissions } from '../../integrations/healthConnect';
import { ensureNotificationPermission } from '../../notifications/channels';
import { FullScreenAlarmStatus, getFullScreenAlarmStatus, openFullScreenAlarmSettings } from '../../notifications/fullScreenAlarm';
import { formatClock } from '../../engine/time';
import { NotificationPrefs, useStore } from '../../state/store';
import { Button, Card, CardTitle, Note, Row, Section } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { font, space } from '../theme';
import { Toggle } from './Toggle';

/** Whether nap / wake alarms can take over the lock screen; re-checked when you come back from Settings. */
function useFullScreenAlarmStatus(): FullScreenAlarmStatus | undefined {
  const [status, setStatus] = useState<FullScreenAlarmStatus>();
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let cancelled = false;
    const check = () => {
      getFullScreenAlarmStatus()
        .then((s) => !cancelled && setStatus(s))
        .catch(() => undefined);
    };
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return status;
}

const FULL_SCREEN_SUB: Record<FullScreenAlarmStatus, string> = {
  allowed: 'On — nap and wake alarms take over the lock screen with Snooze and "I\'m up"',
  blocked: 'Blocked by Android — alarms still ring, but only as a notification. Allow "full-screen notifications" for eepy.',
  unavailable: 'Needs the latest eepy APK — alarms ring as a regular notification for now',
};

function FullScreenAlarmRow() {
  const status = useFullScreenAlarmStatus();
  if (Platform.OS !== 'android' || !status) return null;
  const open = () => openFullScreenAlarmSettings().catch((e) => notify('Settings', e instanceof Error ? e.message : String(e)));
  return (
    <Row style={{ paddingVertical: space.sm }}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={font.body}>Full-screen alarm</Text>
        <Text style={font.small}>{FULL_SCREEN_SUB[status]}</Text>
      </View>
      {status === 'blocked' ? <Button small icon="cellphone-lock" label="Allow" onPress={open} /> : null}
      {status === 'allowed' ? <Button small kind="ghost" label="Settings" onPress={open} /> : null}
    </Row>
  );
}

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
        <Toggle
          label="Phone-light reminder"
          sub="When melatonin starts rising (~3 h before lights-out): Night Light on, screen dimmer"
          value={settings.notifications.screenLight}
          onChange={(v) => setNotif('screenLight', v)}
        />
        <Toggle
          label="Screens-off reminder"
          sub="From the wind-down timeline: phone on the charger, face down"
          value={settings.notifications.screensOff}
          onChange={(v) => setNotif('screensOff', v)}
        />
        <Toggle
          label="Forgot your coffee?"
          sub={'An hour after your usual morning drink, if nothing is logged: "Yes" logs it at your usual time'}
          value={settings.notifications.caffeineNudge}
          onChange={(v) => setNotif('caffeineNudge', v)}
        />
        <Toggle label="Morning check-in" value={settings.notifications.morningCheckIn} onChange={(v) => setNotif('morningCheckIn', v)} />
        <Toggle
          label="Wake alarm (cycle-timed)"
          sub="Rings at the end of a predicted sleep cycle before your wake time"
          value={settings.notifications.smartAlarm}
          onChange={(v) => setNotif('smartAlarm', v)}
        />
        <FullScreenAlarmRow />
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
          sub={`Around ${formatClock(10 * 60)} if last night hasn't arrived from Nothing X`}
          value={settings.notifications.missingNightNudge}
          onChange={(v) => setNotif('missingNightNudge', v)}
        />
      </Card>
    </Section>
  );
}
