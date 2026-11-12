// Settings → Alarms & watch (the wake alarm) and → Notifications & shortcuts (reminders, and what
// eepy does while it is closed).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { BACKGROUND_INTERVAL_MIN, getBackgroundSyncStatus } from '../../background/task';
import { formatClock } from '../../engine/time';
import { getPermissionState, healthConnectStatus, requestHealthPermissions } from '../../integrations/healthConnect';
import { ensureNotificationPermission } from '../../notifications/channels';
import { FullScreenAlarmStatus, getFullScreenAlarmStatus, openFullScreenAlarmSettings } from '../../notifications/fullScreenAlarm';
import { NotificationPrefs, useStore } from '../../state/store';
import { Banner, Fold, ListCard, ListRow, Section } from '../components';
import { notify } from '../confirm';
import { relativeTime } from '../format';
import { errorText, Para } from './parts';
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

const FULL_SCREEN: Record<FullScreenAlarmStatus, { value: string; sub: string }> = {
  allowed: { value: 'On', sub: 'Nap and wake alarms take over the lock screen, with Snooze and "I\'m up"' },
  blocked: { value: 'Blocked', sub: 'Alarms still ring, but only as a notification. Tap to allow full-screen notifications for eepy.' },
  unavailable: { value: 'Not in this build', sub: 'Needs the latest eepy. Alarms ring as a regular notification for now.' },
};

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

/** Turns a notification preference on (after Android's permission prompt) or off. */
function useSetNotif() {
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);
  return async (key: keyof NotificationPrefs, value: boolean) => {
    if (value && !(await ensureNotificationPermission())) {
      notify('Notifications are off', 'Allow notifications for eepy in Android settings to get reminders and alarms.');
      return;
    }
    setNotificationPrefs({ [key]: value });
  };
}

/** Settings → Alarms & watch: eepy's own cycle-timed wake alarm and whether it can take over the lock screen. */
export function WakeAlarmSection() {
  const smartAlarm = useStore((s) => s.settings.notifications.smartAlarm);
  const setNotif = useSetNotif();
  const fullScreen = useFullScreenAlarmStatus();
  const openFullScreen = () => openFullScreenAlarmSettings().catch((e) => notify('Settings', errorText(e)));
  return (
    <Section title="Wake alarm">
      <ListCard>
        <Toggle label="Wake alarm" sub="Rings at the end of a sleep cycle, up to 30 min before your wake-up" value={smartAlarm} onChange={(v) => setNotif('smartAlarm', v)} />
        {Platform.OS === 'android' && fullScreen ? (
          <ListRow title="Full-screen alarm" sub={FULL_SCREEN[fullScreen].sub} value={FULL_SCREEN[fullScreen].value} onPress={fullScreen === 'unavailable' ? undefined : openFullScreen} />
        ) : null}
        <ListRow title="Skip a morning or change a wake-up" sub="Plan › The week ahead" onPress={() => router.navigate('/planner')} />
      </ListCard>
    </Section>
  );
}

/** Settings → Notifications & shortcuts: reminders through the evening and the day. */
export function NotificationsSection() {
  const windDownMin = useStore((s) => s.profile.windDownMin);
  const prefs = useStore((s) => s.settings.notifications);
  const rundownOn = useStore((s) => s.settings.rundown.enabled);
  const setNotif = useSetNotif();

  return (
    <>
      <Section title="In the evening">
        <ListCard>
          <Toggle label="Wind-down reminder" sub={`${windDownMin} min before lights-out`} value={prefs.windDown} onChange={(v) => setNotif('windDown', v)} />
          <Toggle label="Live wind-down card" sub="A pinned checklist until lights-out, instead of the plain reminder" value={prefs.liveWindDown} onChange={(v) => setNotif('liveWindDown', v)} />
          <Toggle label="Phone-light reminder" sub="About 3 h before lights-out: Night Light on, screen dimmer" value={prefs.screenLight} onChange={(v) => setNotif('screenLight', v)} />
          <Toggle label="Phone down in 10 min" sub="A heads-up for last messages and the alarm check" value={prefs.phoneDownSoon} onChange={(v) => setNotif('phoneDownSoon', v)} />
          <Toggle
            label="Screens-off reminder"
            sub={rundownOn ? 'At phone-down: charger across the room, and what comes next' : 'Phone on the charger, face down'}
            value={prefs.screensOff}
            onChange={(v) => setNotif('screensOff', v)}
          />
          <Toggle label="Bedtime" sub="At lights-out" value={prefs.bedtime} onChange={(v) => setNotif('bedtime', v)} />
        </ListCard>
      </Section>
      <Section title="During the day">
        <ListCard>
          <Toggle label="Morning check-in" sub="How did you sleep? Two taps" value={prefs.morningCheckIn} onChange={(v) => setNotif('morningCheckIn', v)} />
          <Toggle label="Caffeine cut-off" sub="When it's time for your last coffee" value={prefs.caffeine} onChange={(v) => setNotif('caffeine', v)} />
          <Toggle label="Forgot your coffee?" sub="An hour after your usual morning drink, if nothing is logged" value={prefs.caffeineNudge} onChange={(v) => setNotif('caffeineNudge', v)} />
          <Toggle label="Adaptive reminders" sub="Only what today needs, at most 5 a day" value={prefs.adaptiveReminders} onChange={(v) => setNotif('adaptiveReminders', v)} />
          <Fold bare title="How these work">
            <Para first>A nap nudge on days you need one. The caffeine last call only on days you log caffeine. Nothing while you nap. Lights-out moves after a long nap.</Para>
            <Para>"Forgot your coffee?" has a Yes button that logs your usual drink at its usual time.</Para>
          </Fold>
        </ListCard>
      </Section>
    </>
  );
}

/** Settings → Notifications & shortcuts: background sync, the morning report and the missing-night nudge. */
export function BackgroundSection() {
  const settings = useStore((s) => s.settings);
  const setBackground = useStore((s) => s.setBackground);
  const setNotif = useSetNotif();
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

  const allowBackground = async () => {
    try {
      const p = await requestHealthPermissions();
      setBgAllowed(p.background);
      if (!p.background) {
        notify('Still off', 'In Health Connect, open App permissions → eepy and turn on "Access data in the background". Older Health Connect versions may not offer it yet.');
      }
    } catch (e) {
      notify('Health Connect', errorText(e));
    }
  };

  let status: string;
  if (Platform.OS !== 'android') status = 'Runs in the Android app.';
  else if (!bg.enabled) status = 'Off: eepy only syncs when you open it.';
  else if (!live) status = 'Paused while demo data is loaded.';
  else if (tasksAvailable === false) status = "Background tasks aren't available in this build. Use the APK.";
  else if (bg.lastRun) status = `Last run ${relativeTime(bg.lastRun)} · ${bg.lastResult ?? 'done'}`;
  else status = `Hasn't run yet. Android runs it at most every ${BACKGROUND_INTERVAL_MIN} min while eepy is closed.`;

  return (
    <Section title="While eepy is closed">
      {bg.enabled && live && bgAllowed === false ? (
        <Banner tone="warn" text="Health Connect only lets eepy read your data while it's open." action="Allow" onAction={allowBackground} />
      ) : null}
      <ListCard>
        <Toggle label="Background sync" sub={status} value={bg.enabled} onChange={(v) => setBackground({ enabled: v })} />
        <Toggle label="Morning report" sub="Last night's sleep, score and debt as soon as it syncs" value={settings.notifications.morningReport} onChange={(v) => setNotif('morningReport', v)} />
        <Toggle
          label="Missing-night nudge"
          sub={`Around ${formatClock(10 * 60)} if last night hasn't arrived from Nothing X`}
          value={settings.notifications.missingNightNudge}
          onChange={(v) => setNotif('missingNightNudge', v)}
        />
      </ListCard>
    </Section>
  );
}
