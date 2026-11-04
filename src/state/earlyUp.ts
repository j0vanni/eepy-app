/**
 * "I'm up" before this morning's alarm — woke early and staying up. Available from 3am until this
 * morning's (final) alarm, with or without a sleep session, on two-step mornings too:
 *
 * - ends an open sleep session (sounds and sleep mode off), else just logs when you got up — the
 *   strongest sign for wake-up detection (engine/wakeDetect.ts);
 * - turns off this morning's alarms still to ring: the final one (WAKE_FINAL_SKIP_MARK) and a two-step
 *   morning's routine alarm (WAKE_ROUTINE_SKIP_MARK) — not a free morning, nothing else changes;
 * - Today switches to the morning (dayPhase.phaseInputFor reads WAKE_UP_EARLY_MARK until the night syncs).
 *
 * Undo puts all of it back (alarms still ahead ring again).
 */
import type { Analysis } from '../engine/analysis';
import { isOpen } from '../engine/inBed';
import { wakeTargetFor } from '../engine/schedule';
import { atMinutes, dateKey, HOUR, MINUTE, minutesOfDay } from '../engine/time';
import type { Profile } from '../engine/types';
import { logOutOfBed, unlogOutOfBed } from '../engine/wakeDetect';
import {
  nextWakeAlarm,
  resetWakeAlarmMemo,
  syncWakeAlarm,
  WAKE_FINAL_SKIP_MARK,
  WAKE_ROUTINE_SKIP_MARK,
  WAKE_UP_EARLY_MARK,
} from '../notifications/fullScreenAlarm';
import { getSleepModeStatus, hasSleepMode, startSleepModeNow, stopSleepModeNow } from '../notifications/sleepMode';
import { endInBedSession, undoEndInBedSession } from './inBed';
import { Settings, useStore } from './store';

/** "I'm up" is offered from this time of the morning (minutes after midnight) … */
export const EARLY_UP_FROM_MIN = 3 * 60;
/** … and the confirmation (with Undo) stays this long. */
export const EARLY_UP_CONFIRM_H = 3;

export interface EarlyUpOffer {
  /** The morning (YYYY-MM-DD). */
  date: string;
  /** This morning's (final) alarm or wake-up. */
  wakeAt: number;
  /** eepy rings the alarms (otherwise they're your own: nothing to turn off). */
  eepyAlarm: boolean;
  /** A two-step morning's routine alarm still to ring. */
  routineAt?: number;
}

/**
 * When you tapped "I'm up" early this morning, if you did. `now` may be a screen's clock that ticks
 * every half minute, so a tap a moment "after" it still counts.
 */
export function upEarlyAt(settings: Pick<Settings, 'marks'>, now: number): number | undefined {
  const t = settings.marks[WAKE_UP_EARLY_MARK];
  return typeof t === 'number' && dateKey(t) === dateKey(now) && t <= now + 2 * MINUTE ? t : undefined;
}

/**
 * Whether "I'm up" (early) makes sense now: after 3am, before this morning's alarm / wake-up, and
 * before tonight's lights-out — and not already tapped this morning.
 */
export function earlyUpOffer(a: Analysis, settings: Settings, profile: Profile, now: number): EarlyUpOffer | undefined {
  if (minutesOfDay(now) < EARLY_UP_FROM_MIN || minutesOfDay(now) >= 12 * 60 || now >= a.tonight.bedtime) return undefined;
  if (upEarlyAt(settings, now) !== undefined) return undefined;
  const today = dateKey(now);
  if (settings.notifications.smartAlarm) {
    const w = nextWakeAlarm(a, settings, now);
    if (dateKey(w.base) === today && w.base > now && !w.done) {
      const routineAt = w.routine && !w.routine.done && w.routine.base > now ? w.routine.base : undefined;
      return { date: today, wakeAt: w.base, eepyAlarm: true, ...(routineAt !== undefined ? { routineAt } : {}) };
    }
  }
  // Your own alarms (or eepy's already done/skipped): this morning's planned wake-up.
  const target = wakeTargetFor(profile, today);
  const wakeAt = atMinutes(today, target.wakeMin);
  if (target.noAlarm || wakeAt <= now) return undefined;
  return { date: today, wakeAt, eepyAlarm: false };
}

export interface EarlyUpUndo {
  upAt: number;
  date: string;
  marks: { final?: Settings['marks'][string]; routine?: Settings['marks'][string] };
  sessionEnded: boolean;
  /** Sleep mode was on and switched off (back on until then on Undo). */
  sleepModeUntil?: number;
}

async function resync(analysis: Analysis): Promise<void> {
  const state = useStore.getState();
  // Required lazily: the scheduler pulls in every notification feature.
  const { replanNotifications } = require('../notifications/scheduler') as typeof import('../notifications/scheduler');
  resetWakeAlarmMemo();
  await replanNotifications(analysis, state).catch(() => undefined);
  await syncWakeAlarm(analysis, state).catch(() => undefined);
}

/** "I'm up" before the alarm. Returns what Undo needs. */
export async function imUpEarly(a: Analysis, now = Date.now()): Promise<EarlyUpUndo> {
  const st = useStore.getState();
  const offer = earlyUpOffer(a, st.settings, st.profile, now);
  const date = offer?.date ?? dateKey(now);
  const marks = { final: st.settings.marks[WAKE_FINAL_SKIP_MARK], routine: st.settings.marks[WAKE_ROUTINE_SKIP_MARK] };
  // The session (if any) ends with its own "I'm up" — that also logs when you got up (to the minute).
  const sessionEnded = isOpen(st.settings.session) ? await endInBedSession('today', a, now).catch(() => false) : false;
  const upAt = sessionEnded ? (useStore.getState().settings.session?.upAt ?? toMinute(now)) : toMinute(now);
  if (!sessionEnded) st.updateWakeLog((log) => logOutOfBed(log, upAt));
  if (offer?.eepyAlarm) {
    st.setMark(WAKE_FINAL_SKIP_MARK, date);
    if (offer.routineAt !== undefined) {
      st.setMark(WAKE_ROUTINE_SKIP_MARK, date);
      const { cancelRoutineAlarms } = require('../notifications/features/reminders') as typeof import('../notifications/features/reminders');
      await cancelRoutineAlarms().catch(() => undefined);
    }
  }
  st.setMark(WAKE_UP_EARLY_MARK, upAt);
  // Lights on: sleep mode off (a session's "I'm up" already did that).
  let sleepModeUntil: number | undefined;
  if (!sessionEnded && st.settings.sleepMode.enabled && hasSleepMode()) {
    const status = await getSleepModeStatus().catch(() => undefined);
    if (status?.active && (await stopSleepModeNow(date).catch(() => false))) sleepModeUntil = offer?.wakeAt;
  }
  await resync(a);
  return { upAt, date, marks, sessionEnded, ...(sleepModeUntil !== undefined ? { sleepModeUntil } : {}) };
}

const toMinute = (t: number) => Math.floor(t / MINUTE) * MINUTE;

/** The range a corrected wake-up time can take this morning: from 3am (or an hour after "I'm in bed") until now. */
export function wakeTimeRange(settings: Pick<Settings, 'session'>, now: number): { min: number; max: number } {
  const s = settings.session;
  const from = atMinutes(dateKey(now), EARLY_UP_FROM_MIN);
  const afterBed = s && dateKey(s.inBedAt + 12 * HOUR) === dateKey(now) ? s.inBedAt + 60 * MINUTE : from;
  return { min: Math.max(from, afterBed), max: toMinute(now) };
}

/**
 * "Woke up at …": sets (or corrects) this morning's wake-up — woke earlier than you tapped "I'm up",
 * or never tapped at all. The time is what Today, the morning and wake-up detection go by until the
 * night syncs (then the night screen's own corrections take over): the logged "I'm up" moves, and a
 * sleep session that ended this morning gets the same time.
 */
export function setMorningWakeTime(t: number, now = Date.now()): number {
  const st = useStore.getState();
  const { min, max } = wakeTimeRange(st.settings, now);
  const at = Math.min(max, Math.max(min, toMinute(t)));
  const prev = upEarlyAt(st.settings, now);
  const s = st.settings.session;
  const sessionUp = s?.closed === 'up' && s.upAt !== undefined && dateKey(s.upAt) === dateKey(now) ? s.upAt : undefined;
  st.updateWakeLog((log) => logOutOfBed(unlogOutOfBed(unlogOutOfBed(log, prev), sessionUp), at));
  if (sessionUp !== undefined && s) st.setSettings({ session: { ...s, upAt: at } });
  st.setMark(WAKE_UP_EARLY_MARK, at);
  return at;
}

/** Undo: back in bed — the alarms still ahead ring again, the session (if any) is open again. */
export async function undoEarlyUp(u: EarlyUpUndo, a: Analysis): Promise<void> {
  const st = useStore.getState();
  st.setMark(WAKE_FINAL_SKIP_MARK, u.marks.final);
  st.setMark(WAKE_ROUTINE_SKIP_MARK, u.marks.routine);
  // The time may have been corrected since ("Woke up at …"): forget whichever is recorded now.
  const current = st.settings.marks[WAKE_UP_EARLY_MARK];
  const recorded = typeof current === 'number' && dateKey(current) === u.date ? current : u.upAt;
  if (typeof current === 'number' && dateKey(current) === u.date) st.setMark(WAKE_UP_EARLY_MARK, undefined);
  if (u.sessionEnded) await undoEndInBedSession().catch(() => undefined);
  st.updateWakeLog((log) => unlogOutOfBed(unlogOutOfBed(log, u.upAt), recorded));
  if (u.sleepModeUntil !== undefined && u.sleepModeUntil > Date.now() && hasSleepMode()) await startSleepModeNow(u.date, u.sleepModeUntil).catch(() => false);
  await resync(a);
}

/** Whether the "Up at …" confirmation (with Undo) still shows. */
export function earlyUpConfirmShows(upAt: number | undefined, now: number): upAt is number {
  return upAt !== undefined && now - upAt < EARLY_UP_CONFIRM_H * HOUR;
}

/** The screen's clock, but never before an "I'm up" just tapped (so Today switches to the morning right away). */
export function nowAfterUp(settings: Pick<Settings, 'marks'>, now: number): number {
  const t = upEarlyAt(settings, now);
  return t !== undefined && t > now ? t : now;
}
