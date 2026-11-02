/**
 * The sleep session's side effects (the decisions are in engine/inBed.ts):
 * - "I'm in bed": tonight's lights-out (settings.tonight, so the alarm re-times), the tap in the wake
 *   log, the phone's sleep mode (bedtime autopilot) and the default sleep sound, and the evening
 *   notifications cleared. The root layout re-plans notifications and alarms when `settings.session`
 *   changes, and the planners keep tonight's reminders quiet while it's open.
 * - Cancel / Undo puts the plan back and stops what the tap started.
 * - "I'm up" (Today, the wake alarm's check-in, the routine card): the up time, sleep mode and sounds
 *   off. Alarms are left alone (one still to ring rings — it's never silenced by a stray tap). Undo
 *   opens the session again.
 * - Stale sessions close by themselves (`closeStaleInBed`, from the root layout and the background task).
 */
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { AppState as RNAppState, Platform } from 'react-native';

import { soundPlayer } from '../audio/player';
import type { Analysis } from '../engine/analysis';
import { dayPhase, phaseInputFor } from '../engine/dayPhase';
import { closeInBed, IN_BED, InBedSession, isOpen, planInBed, reopenInBed, SessionAlarm, staleInBed, tapsNightOffer } from '../engine/inBed';
import { dateKey, MINUTE } from '../engine/time';
import { logInBed, logOutOfBed, logUp, unlogInBed, unlogOutOfBed } from '../engine/wakeDetect';
import { nextWakeAlarm } from '../notifications/fullScreenAlarm';
import { eveningNotificationIds } from '../notifications/ids';
import { getSleepModeStatus, hasSleepMode, sleepModeWindow, sleepSoundsLabel, startSleepModeNow, stopSleepModeNow, undoSleepModeStart } from '../notifications/sleepMode';
import { Settings, useStore } from './store';
import { useNow } from './useAnalysis';

type AlarmSettings = Pick<Settings, 'marks' | 'watch' | 'notifications'>;

/** The open session Today shows for this analysis (tonight's, or this morning's after 4am). */
export function sessionFor(s: InBedSession | undefined, a: Pick<Analysis, 'day' | 'tonight'>): InBedSession | undefined {
  return s && (s.wakeDate === a.tonight.wakeDate || s.wakeDate === a.day) ? s : undefined;
}

/** Whether "I'm in bed" makes sense now: the evening or the night (not the middle of the day). */
export function inBedAvailable(a: Analysis, profile: Parameters<typeof phaseInputFor>[1], now: number): boolean {
  const phase = dayPhase(now, phaseInputFor(a, profile));
  return phase === 'evening' || phase === 'night';
}

/** Tapped after 4am before this morning's wake-up: the session is this morning's (nothing re-timed). */
function morningOf(a: Analysis, profile: Parameters<typeof phaseInputFor>[1], now: number): { wakeDate: string; wakeAt: number } | undefined {
  const input = phaseInputFor(a, profile);
  return dayPhase(now, input) === 'night' && now < input.bedtime ? { wakeDate: a.day, wakeAt: input.wakeTime } : undefined;
}

/**
 * The session's alarm as eepy will ring it: tonight's (re-timed) alarm, or — after 4am — this
 * morning's held one; skipped / already stopped; or your own alarm when eepy's is off.
 */
export function sessionAlarm(a: Analysis, settings: AlarmSettings, s: InBedSession, now: number): SessionAlarm {
  const sameNight = a.tonight.wakeDate === s.wakeDate;
  const wake = sameNight ? a.tonight.wake : s.wakeAt;
  const cycles = sameNight ? (a.alarm.onBoundary && !a.tonight.noAlarm ? a.alarm.cycles : undefined) : s.cycles;
  // Your own alarm: the best cycle-end wake-up to set it to (not on a two-step morning — that's the routine's).
  if (!settings.notifications.smartAlarm) return { state: 'own', wake, ...(sameNight && !a.tonight.twoStep ? { at: a.alarm.alarm } : {}), ...(cycles ? { cycles } : {}) };
  const w = nextWakeAlarm(a, settings, now);
  // eepy has moved on to the next morning's alarm: this one has rung (or was stopped from the watch).
  if (dateKey(w.base) !== s.wakeDate) return { state: 'past', wake };
  if (w.skipped) return { state: 'skipped', wake };
  if (w.done) return { state: 'off', wake };
  if (w.routine && !w.routine.done) return { state: 'set', at: w.base, routineAt: w.routine.base, wake, ...(cycles ? { cycles } : {}) };
  // A two-step morning past its routine alarm: the final alarm isn't cycle-timed.
  const twoStep = sameNight ? !!a.tonight.twoStep : !!s.twoStep;
  return { state: 'set', at: w.base, wake, ...(cycles && !twoStep ? { cycles } : {}) };
}

/** Clears tonight's wind-down / lights-out / screens-off notifications already on screen. */
function dismissEvening(wakeDate: string): void {
  if (Platform.OS === 'web') return;
  for (const id of eveningNotificationIds(wakeDate)) Notifications.dismissNotificationAsync(id).catch(() => undefined);
}

/** Patches the stored session if it's still the one started at `inBedAt`. */
function patchSession(inBedAt: number, patch: Partial<InBedSession>): boolean {
  const s = useStore.getState().settings.session;
  if (!s || s.inBedAt !== inBedAt) return false;
  useStore.getState().setSettings({ session: { ...s, ...patch } });
  return true;
}

const playing = () => soundPlayer.getState().status === 'playing';

/**
 * "I'm in bed": starts tonight's session from the current analysis. Resolves with the session once
 * sleep mode and sounds have had their go (the store is updated right away, so Today switches to the
 * night view at once).
 */
export async function startInBedSession(a: Analysis, now = Date.now()): Promise<InBedSession> {
  const state = useStore.getState();
  const { settings, profile } = state;
  const plan = planInBed(
    {
      tonight: a.tonight,
      cycleMin: a.cycleMin,
      latencyMin: a.latencyMin,
      efficiency: a.efficiency,
      windDownMin: profile.windDownMin,
      override: settings.tonight,
      morning: morningOf(a, profile, now),
    },
    now,
  );
  // The analysis as it will be once the new lights-out is in: for the alarm the confirmation names
  // and the time sleep mode switches off.
  const projected: Analysis = plan.projected ? { ...a, tonight: plan.projected.tonight, alarm: plan.projected.alarm } : a;
  const session = plan.session;
  state.setSettings({ session, tonight: plan.override });
  state.updateWakeLog((log) => logInBed(log, session.inBedAt));
  dismissEvening(session.wakeDate);

  // Sleep sounds: the default sound with its timer, unless something is playing already.
  const patch: Partial<InBedSession> = {};
  if (settings.inBedSounds !== false && !playing()) {
    void soundPlayer.play(settings.audio);
    patch.soundsStarted = true;
    patch.sounds = sleepSoundsLabel(settings.audio);
  }
  if (Object.keys(patch).length) patchSession(session.inBedAt, patch);

  // The phone's sleep mode, until the alarm (bedtime autopilot on, and allowed).
  if (settings.sleepMode.enabled && hasSleepMode()) {
    const status = await getSleepModeStatus();
    if (status?.active) patchSession(session.inBedAt, { sleepModeOn: true });
    else if (status?.access && isOpen(useStore.getState().settings.session)) {
      const window = plan.projected ? sleepModeWindow(projected, useStore.getState().settings, now) : undefined;
      const morningAlarm = !plan.projected && settings.notifications.smartAlarm ? nextWakeAlarm(a, settings, now) : undefined;
      const off = window?.off ?? (morningAlarm && !morningAlarm.done ? morningAlarm.base : session.wakeAt);
      const ok = await startSleepModeNow(window?.night ?? session.wakeDate, off);
      // Cancelled while Android was switching it on: switch it off again.
      if (ok && !patchSession(session.inBedAt, { sleepModeStarted: true, sleepModeOn: true })) await undoSleepModeStart(session.wakeDate);
    }
  }
  return useStore.getState().settings.session ?? session;
}

/** Cancel / Undo of "I'm in bed": the plan as it was, the tap forgotten, sleep mode and sounds it started stopped. */
export async function cancelInBedSession(): Promise<void> {
  const state = useStore.getState();
  const s = state.settings.session;
  if (!s) return;
  const cur = state.settings.tonight;
  // Only put the plan back if tonight's lights-out is still the tap (you may have adjusted it since).
  const restore = s.retimed && cur?.wakeDate === s.wakeDate && cur.bedtime === s.inBedAt;
  state.setSettings({ session: undefined, ...(restore ? { tonight: s.prevTonight } : {}) });
  state.updateWakeLog((log) => unlogOutOfBed(unlogInBed(log, s.inBedAt), s.upAt));
  if (s.soundsStarted && playing()) soundPlayer.stop();
  if (s.sleepModeStarted && s.sleepModeStopped === undefined) await undoSleepModeStart(s.wakeDate);
}

/**
 * "I'm up": ends the session. `today` / `routine` = you said so in eepy (logged as an out-of-bed tap);
 * `alarm` = the full-screen alarm's "I'm up" (logged like a watch-buzz "I'm up"); `watch` = the
 * watch buzz's "I'm up" (already logged). Returns false when there was nothing to end.
 */
export async function endInBedSession(via: 'today' | 'routine' | 'alarm' | 'watch', a?: Analysis, now = Date.now()): Promise<boolean> {
  const state = useStore.getState();
  const s = state.settings.session;
  if (!isOpen(s)) return false;
  // An alarm's "I'm up" right after going to bed isn't this morning's (a replayed response, a test alarm).
  if ((via === 'alarm' || via === 'watch') && now - s.inBedAt < IN_BED.minNightMin * MINUTE) return false;
  const closed = closeInBed(s, now, 'up');
  const upAt = closed.upAt!;
  if (via === 'today' || via === 'routine') state.updateWakeLog((log) => logOutOfBed(log, upAt));
  else if (via === 'alarm') state.updateWakeLog((log) => logUp(log, upAt));
  if (playing()) soundPlayer.stop();
  state.setSettings({ session: closed });
  if (state.settings.sleepMode.enabled && hasSleepMode()) {
    const status = await getSleepModeStatus();
    // Until when it was to stay on (for Undo): the alarm still to ring this morning, else the wake-up.
    const alarm = a ? sessionAlarm(a, state.settings, s, now) : undefined;
    const until = alarm?.state === 'set' && alarm.at !== undefined && alarm.at > now ? alarm.at : s.wakeAt;
    if (status?.active && (await stopSleepModeNow(s.wakeDate))) patchSession(s.inBedAt, { sleepModeStopped: until });
  }
  return true;
}

/** Undo of "I'm up": open again, the up tap forgotten, sleep mode back on until it was to switch off. */
export async function undoEndInBedSession(): Promise<void> {
  const state = useStore.getState();
  const s = state.settings.session;
  if (!s || s.closed !== 'up') return;
  state.setSettings({ session: reopenInBed(s) });
  state.updateWakeLog((log) => unlogOutOfBed(log, s.upAt));
  const until = s.sleepModeStopped;
  if (until !== undefined && until > Date.now() && hasSleepMode() && (await startSleepModeNow(s.wakeDate, until))) {
    patchSession(s.inBedAt, { sleepModeOn: true });
  }
}

/** Closes a session nobody ended once it's stale (stops a sound it started that's still playing). True when it did. */
export function closeStaleInBed(now = Date.now()): boolean {
  const s = useStore.getState().settings.session;
  if (!staleInBed(s, now) || !s) return false;
  useStore.getState().setSettings({ session: closeInBed(s, now, 'auto') });
  if (s.soundsStarted && playing()) soundPlayer.stop();
  return true;
}

/** "Save last night from your taps": in bed → up as last night's sleep (the manual-session path). */
export function saveTapsNight(a: Pick<Analysis, 'day' | 'lastNightIsCurrent' | 'latencyMin'>): string | undefined {
  const state = useStore.getState();
  const s = state.settings.session;
  const night = tapsNightOffer(s, { day: a.day, lastNightIsCurrent: a.lastNightIsCurrent, latencyMin: a.latencyMin });
  if (!s || !night) return undefined;
  state.addManualSession(night);
  state.setSettings({ session: { ...s, savedId: night.id } });
  return night.id;
}

/** "Not now" on that offer. */
export function dismissTapsNight(): void {
  const s = useStore.getState().settings.session;
  if (s) useStore.getState().setSettings({ session: { ...s, dismissed: true } });
}

/** Mount once (root layout): closes a stale session every minute and when eepy comes to the front. */
export function useInBedAutoClose(): void {
  const now = useNow(MINUTE);
  const open = useStore((s) => isOpen(s.settings.session));
  useEffect(() => {
    if (open) closeStaleInBed(now);
  }, [open, now]);
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (st) => st === 'active' && closeStaleInBed());
    return () => sub.remove();
  }, []);
}
