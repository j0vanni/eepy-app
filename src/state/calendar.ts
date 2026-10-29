/**
 * Calendar access (read-only): tomorrow's first event drives the alarm/bedtime plan, and tonight's
 * late events get flagged. The native module is only touched on Android/iOS; in the browser build,
 * demo mode uses sample events so the feature can still be explored.
 *
 * Choosing events is pure logic in `engine/calendarEvents.ts`; this file only reads the device.
 */
import type { ExpoCalendarEvent, PermissionResponse } from 'expo-calendar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { CalendarEvent, livingDay, morningCandidates, tomorrowWindow, tonightWindow } from '../engine/calendarEvents';
import { addDays, atMinutes, MINUTE } from '../engine/time';
import { CalendarSettings, useStore } from './store';

export type { CalendarEvent } from '../engine/calendarEvents';

/** `blocked` = denied and Android won't ask again (the user has to allow it in system settings). */
export type CalendarAccess = 'granted' | 'denied' | 'blocked' | 'undetermined' | 'unsupported';

export interface DeviceCalendar {
  id: string;
  title: string;
  color?: string;
  /** Account the calendar belongs to (e.g. a Google account). */
  account?: string;
  /** Owner's email, used to spot invitations the user declined. */
  ownerEmail?: string;
  isPrimary?: boolean;
}

type CalendarModule = typeof import('expo-calendar');

const NATIVE = Platform.OS === 'android' || Platform.OS === 'ios';
let nativeModule: CalendarModule | null | undefined;

/** Loaded lazily so tests and the web build never initialise the native module. */
function native(): CalendarModule | undefined {
  if (!NATIVE) return undefined;
  if (nativeModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativeModule = require('expo-calendar') as CalendarModule;
    } catch (e) {
      console.warn('expo-calendar is unavailable', e);
      nativeModule = null;
    }
  }
  return nativeModule ?? undefined;
}

function demoActive(): boolean {
  return !NATIVE && useStore.getState().settings.dataMode === 'demo';
}

/** Calendar features work here: a phone build, or demo mode in the browser (sample events). */
export function calendarSupported(): boolean {
  return NATIVE || demoActive();
}

/** The browser demo is showing sample events instead of a real calendar. */
export function usingDemoCalendar(): boolean {
  return demoActive();
}

function toAccess(r: PermissionResponse): CalendarAccess {
  if (r.granted) return 'granted';
  if (String(r.status) === 'denied') return r.canAskAgain ? 'denied' : 'blocked';
  return 'undetermined';
}

export async function getCalendarAccess(): Promise<CalendarAccess> {
  const Cal = native();
  if (!Cal) return demoActive() ? 'granted' : 'unsupported';
  try {
    return toAccess(await Cal.getCalendarPermissions());
  } catch {
    return 'unsupported';
  }
}

/** Shows the system permission prompt (Android asks for read + write; eepy only reads). */
export async function requestCalendarAccess(): Promise<CalendarAccess> {
  const Cal = native();
  if (!Cal) return demoActive() ? 'granted' : 'unsupported';
  try {
    const access = toAccess(await Cal.requestCalendarPermissions());
    invalidateCalendarCache();
    return access;
  } catch {
    return 'unsupported';
  }
}

const DEMO_CALENDARS: DeviceCalendar[] = [
  { id: 'demo-work', title: 'Work', color: '#6CC6FF', account: 'Sample calendar', isPrimary: true },
  { id: 'demo-personal', title: 'Personal', color: '#FFB86B', account: 'Sample calendar' },
];

/** Visible calendars on the device (primary calendars first). */
export async function listDeviceCalendars(): Promise<DeviceCalendar[]> {
  const Cal = native();
  if (!Cal) return demoActive() ? DEMO_CALENDARS : [];
  try {
    if ((await getCalendarAccess()) !== 'granted') return [];
    const cals = await Cal.getCalendars(Platform.OS === 'ios' ? Cal.EntityTypes.EVENT : undefined);
    return cals
      .filter((c) => c.isVisible !== false)
      .map((c) => ({
        id: String(c.id),
        title: c.title || c.name || 'Calendar',
        color: c.color || undefined,
        account: c.source?.name || c.ownerAccount || undefined,
        ownerEmail: c.ownerAccount || undefined,
        isPrimary: c.isPrimary,
      }))
      .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary) || (a.account ?? '').localeCompare(b.account ?? '') || a.title.localeCompare(b.title));
  } catch (e) {
    console.warn('Reading calendars failed', e);
    return [];
  }
}

/** The selected calendars that still exist on the device; empty means "all of them". */
export function effectiveCalendarIds(selected: string[], calendars: DeviceCalendar[]): string[] {
  const ids = new Set(calendars.map((c) => c.id));
  return selected.filter((id) => ids.has(id));
}

function demoEvents(settings: CalendarSettings, from: number, to: number): CalendarEvent[] {
  const today = livingDay(Date.now());
  const tomorrow = addDays(today, 1);
  const all: CalendarEvent[] = [
    { id: 'demo-dinner', calendarId: 'demo-personal', title: 'Dinner with friends', start: atMinutes(today, 19 * 60 + 30), end: atMinutes(today, 22 * 60 + 30), allDay: false },
    { id: 'demo-standup', calendarId: 'demo-work', title: 'Team stand-up', start: atMinutes(tomorrow, 7 * 60 + 30), end: atMinutes(tomorrow, 7 * 60 + 45), allDay: false },
    { id: 'demo-review', calendarId: 'demo-work', title: 'Design review', start: atMinutes(tomorrow, 11 * 60), end: atMinutes(tomorrow, 12 * 60), allDay: false },
    { id: 'demo-birthday', calendarId: 'demo-personal', title: "Sam's birthday", start: atMinutes(tomorrow, 0), end: atMinutes(addDays(tomorrow, 1), 0), allDay: true },
  ];
  const chosen = effectiveCalendarIds(settings.calendarIds, DEMO_CALENDARS);
  return all.filter((e) => (chosen.length === 0 || chosen.includes(e.calendarId!)) && e.end > from && e.start < to);
}

interface LoadedEvent {
  event: CalendarEvent;
  raw?: ExpoCalendarEvent;
  ownerEmail?: string;
}

const toMs = (d: string | Date | null | undefined): number | undefined => {
  if (d === null || d === undefined) return undefined;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : undefined;
};

/** Events overlapping [from, to) in the selected calendars. Throws on native errors. */
async function loadEvents(settings: CalendarSettings, from: number, to: number): Promise<LoadedEvent[]> {
  if (!settings.enabled || to <= from) return [];
  const Cal = native();
  if (!Cal) return demoActive() ? demoEvents(settings, from, to).map((event) => ({ event })) : [];
  if ((await getCalendarAccess()) !== 'granted') return [];
  const calendars = await listDeviceCalendars();
  const chosen = effectiveCalendarIds(settings.calendarIds, calendars);
  const ids = chosen.length ? chosen : calendars.map((c) => c.id);
  if (ids.length === 0) return [];
  const owners = new Map(calendars.map((c) => [c.id, c.ownerEmail]));
  const raw = await Cal.listEvents(ids, new Date(from), new Date(to));
  const out: LoadedEvent[] = [];
  for (const e of raw) {
    const start = toMs(e.startDate);
    if (start === undefined) continue;
    const calendarId = e.calendarId !== undefined && e.calendarId !== null ? String(e.calendarId) : undefined;
    out.push({
      raw: e,
      ownerEmail: calendarId ? owners.get(calendarId) : undefined,
      event: {
        id: String(e.instanceId ?? e.id),
        calendarId,
        title: (e.title ?? '').trim(),
        start,
        end: toMs(e.endDate) ?? start,
        allDay: !!e.allDay,
        canceled: String(e.status) === 'canceled',
      },
    });
  }
  return out;
}

/** Whether the user declined this invitation (attendee list; false when unknown). */
async function declinedByMe(l: LoadedEvent): Promise<boolean> {
  if (!l.raw || typeof l.raw.getAttendees !== 'function') return !!l.event.declined;
  try {
    const attendees = await l.raw.getAttendees();
    if (!attendees?.length) return false;
    const owner = l.ownerEmail?.toLowerCase();
    const me = attendees.find((a) => a.isCurrentUser || (!!owner && a.email?.toLowerCase() === owner));
    return String(me?.status) === 'declined';
  } catch {
    return false;
  }
}

// Several screens ask at once; share one read per settings + window for a few minutes.
const CACHE_MS = 5 * MINUTE;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 24) cache.delete(cache.keys().next().value!);
  return value;
}

/** Forget cached reads (after a permission change, or when the app comes back to the foreground). */
export function invalidateCalendarCache() {
  cache.clear();
}

const settingsKey = (s: CalendarSettings) => `${[...s.calendarIds].sort().join(',')}|${demoActive() ? 'demo' : 'device'}`;

/** Tomorrow's first timed, non-declined event (from 03:00; earlier ones belong to tonight). */
export async function getFirstEventTomorrowDetails(settings: CalendarSettings, now = Date.now()): Promise<CalendarEvent | undefined> {
  if (!settings.enabled) return undefined;
  const win = tomorrowWindow(now);
  return cached(`first|${settingsKey(settings)}|${win.date}`, async () => {
    try {
      const loaded = await loadEvents(settings, win.from, win.to);
      const byEvent = new Map(loaded.map((l) => [l.event, l]));
      // Checking attendees is a query per event, so only look at the first few candidates.
      for (const event of morningCandidates([...byEvent.keys()], win.date).slice(0, 8)) {
        if (!(await declinedByMe(byEvent.get(event)!))) return event;
      }
      return undefined;
    } catch (e) {
      console.warn('Reading tomorrow’s events failed', e);
      return undefined;
    }
  });
}

/** Start (epoch ms) of the first timed event tomorrow in the selected calendars. */
export async function getFirstEventTomorrow(settings: CalendarSettings, now = Date.now()): Promise<number | undefined> {
  return (await getFirstEventTomorrowDetails(settings, now))?.start;
}

/** Timed events still to come tonight (now until 03:00), declined ones removed, by end time. */
export async function getEventsTonight(settings: CalendarSettings, now = Date.now()): Promise<CalendarEvent[]> {
  if (!settings.enabled) return [];
  const win = tonightWindow(now);
  return cached(`tonight|${settingsKey(settings)}|${Math.floor(now / CACHE_MS)}`, async () => {
    try {
      const loaded = (await loadEvents(settings, win.from, win.to)).filter((l) => !l.event.allDay && !l.event.canceled && l.event.end > now).slice(0, 12);
      const out: CalendarEvent[] = [];
      for (const l of loaded) if (!(await declinedByMe(l))) out.push(l.event);
      return out.sort((a, b) => a.end - b.end);
    } catch (e) {
      console.warn('Reading tonight’s events failed', e);
      return [];
    }
  });
}

/** Re-reads every few minutes and whenever the app returns to the foreground (e.g. after editing the calendar). */
function useRefreshTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), CACHE_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      invalidateCalendarCache();
      setTick((t) => t + 1);
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return tick;
}

const sameEvents = (a: CalendarEvent[] | undefined, b: CalendarEvent[]) =>
  !!a && a.length === b.length && a.every((e, i) => e.id === b[i].id && e.start === b[i].start && e.end === b[i].end && e.title === b[i].title);

function useCalendarQuery<T>(settings: CalendarSettings, read: () => Promise<T>, empty: T, same: (a: T, b: T) => boolean): T {
  const tick = useRefreshTick();
  const dataMode = useStore((s) => s.settings.dataMode);
  const day = livingDay(Date.now());
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    let cancelled = false;
    if (!settings.enabled) {
      setValue(empty);
      return;
    }
    read()
      .then((v) => !cancelled && setValue((prev) => (same(prev, v) ? prev : v)))
      .catch(() => !cancelled && setValue(empty));
    return () => {
      cancelled = true;
    };
    // `read` and `empty` are recreated every render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, tick, day, dataMode]);
  return settings.enabled ? value : empty;
}

const NO_EVENTS: CalendarEvent[] = [];

/** Tomorrow's first event, refreshed when settings change, every few minutes and on foreground. */
export function useFirstEventTomorrowDetails(settings: CalendarSettings): CalendarEvent | undefined {
  return useCalendarQuery<CalendarEvent | undefined>(
    settings,
    () => getFirstEventTomorrowDetails(settings),
    undefined,
    (a, b) => a?.id === b?.id && a?.start === b?.start && a?.title === b?.title,
  );
}

/** React hook wrapper around getFirstEventTomorrow, refreshed when settings change. */
export function useFirstEventTomorrow(settings: CalendarSettings): number | undefined {
  return useFirstEventTomorrowDetails(settings)?.start;
}

/** Tonight's remaining timed events (for the late-event note). */
export function useEventsTonight(settings: CalendarSettings): CalendarEvent[] {
  return useCalendarQuery(settings, () => getEventsTonight(settings), NO_EVENTS, (a, b) => sameEvents(a, b));
}
