/**
 * Pure calendar helpers: which events matter for tonight's plan. The device calendar is read in
 * `src/state/calendar.ts`; everything here works on plain event objects so it stays testable.
 */
import { addDays, atMinutes, dateKey, formatDuration, formatTime, HOUR, MINUTE, minutesOfDay } from './time';

export interface CalendarEvent {
  id: string;
  calendarId?: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  /** The user declined the invitation (when the calendar reports attendee status). */
  declined?: boolean;
  /** The organiser cancelled the event. */
  canceled?: boolean;
}

/**
 * Events that start between midnight and this time belong to the night before (a late party, a
 * night shift), not to the morning — they are flagged as late events instead of setting the alarm.
 */
export const MORNING_STARTS_MIN = 3 * 60;

/** The day the user is "living": before 04:00 still counts as the previous day (same rule as the analysis). */
export function livingDay(now: number): string {
  return minutesOfDay(now) < 240 ? addDays(dateKey(now), -1) : dateKey(now);
}

/** Tomorrow (local 00:00–24:00), the day whose first event can set the alarm. */
export function tomorrowWindow(now: number): { date: string; from: number; to: number } {
  const date = addDays(livingDay(now), 1);
  return { date, from: atMinutes(date, 0), to: atMinutes(addDays(date, 1), 0) };
}

/** What's left of tonight: from now until early tomorrow morning. */
export function tonightWindow(now: number): { from: number; to: number } {
  const date = addDays(livingDay(now), 1);
  return { from: now, to: atMinutes(date, MORNING_STARTS_MIN) };
}

/** A timed event the user is actually going to (not all-day, declined or cancelled). */
export function isTimedCommitment(e: CalendarEvent): boolean {
  return !e.allDay && !e.declined && !e.canceled && Number.isFinite(e.start) && e.end >= e.start;
}

/** Morning-and-day events on `date` (from 03:00) that can set the alarm, earliest first. */
export function morningCandidates(events: CalendarEvent[], date: string): CalendarEvent[] {
  const from = atMinutes(date, MORNING_STARTS_MIN);
  const to = atMinutes(addDays(date, 1), 0);
  return events.filter((e) => isTimedCommitment(e) && e.start >= from && e.start < to).sort((a, b) => a.start - b.start);
}

/** The first event on `date` that the user needs to be up for. */
export function pickFirstEvent(events: CalendarEvent[], date: string): CalendarEvent | undefined {
  return morningCandidates(events, date)[0];
}

/** Keeps calendar titles short enough for a one-line rationale. */
export function shortTitle(title: string | undefined, max = 40): string | undefined {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const MEAL_RE = /\b(dinner|supper|drinks?|restaurant|bar|pub|party|date night|birthday|beers?|wine|cocktails?|tasting|barbecue|bbq)\b/i;
const WORKOUT_RE =
  /\b(gym|workout|training|run|running|football|soccer|basketball|tennis|squash|padel|badminton|swim|swimming|climbing|bouldering|crossfit|spin|cycling|hiit|boxing|martial|judo|karate|match|practice|game)\b/i;

export type EveningConflictKind = 'past-bedtime' | 'short-wind-down';

export interface EveningConflict {
  event: CalendarEvent;
  kind: EveningConflictKind;
  /** Minutes between the event ending and lights out (negative when it runs past bedtime). */
  windDownLeftMin: number;
  /** Looks like a meal or drinks that ends inside the 3 hours before bed. */
  lateMeal: boolean;
  /** Looks like exercise that ends within 2 hours of bed. */
  lateWorkout: boolean;
  headline: string;
  advice: string;
}

export interface EveningPlan {
  windDownStart: number;
  bedtime: number;
  wake: number;
  lastMeal: number;
}

/**
 * Tonight's events that eat into the wind-down or the night, with a gentle suggestion for each.
 * Events that end before the wind-down starts (or have already ended) are ignored.
 */
export function eveningConflicts(events: CalendarEvent[], plan: EveningPlan, now: number): EveningConflict[] {
  const windDownMin = Math.round((plan.bedtime - plan.windDownStart) / MINUTE);
  const out: EveningConflict[] = [];
  const relevant = events
    .filter((e) => isTimedCommitment(e) && e.end > Math.max(now, plan.windDownStart) && e.start < plan.wake - HOUR)
    .sort((a, b) => a.end - b.end);
  for (const event of relevant) {
    const name = `“${shortTitle(event.title) ?? 'Event'}”`;
    const left = Math.round((plan.bedtime - event.end) / MINUTE);
    const lateMeal = MEAL_RE.test(event.title) && event.end > plan.lastMeal;
    const lateWorkout = WORKOUT_RE.test(event.title) && event.end > plan.bedtime - 2 * HOUR;
    const extras: string[] = [];
    if (lateMeal) extras.push('Eat lightly and go easy on alcohol — both break up sleep later in the night.');
    if (lateWorkout) extras.push('Keep the effort moderate if you can; very hard exercise right before bed delays sleep for some people.');

    if (event.end > plan.bedtime) {
      const startsAfter = event.start >= plan.bedtime;
      const headline = startsAfter
        ? `${name} at ${formatTime(event.start)} is after your ${formatTime(plan.bedtime)} lights-out`
        : `${name} runs until ${formatTime(event.end)} — past your ${formatTime(plan.bedtime)} lights-out`;
      const inBed = Math.round((plan.wake - event.end) / MINUTE) - 20;
      const advice = [
        inBed > 0 ? `That leaves about ${formatDuration(inBed)} in bed.` : '',
        `Keep tomorrow's ${formatTime(plan.wake)} wake-up if you can (sleeping in shifts your body clock) and catch up with an earlier night after.`,
        'Head straight to bed when you get home: lights low, no screens.',
        ...extras,
      ]
        .filter(Boolean)
        .join(' ');
      out.push({ event, kind: 'past-bedtime', windDownLeftMin: left, lateMeal, lateWorkout, headline, advice });
    } else {
      const headline = `${name} ends ${formatTime(event.end)} — your wind-down will be short (${left} min instead of ${windDownMin})`;
      const advice = [
        'Start winding down on the way home — dim lights, no work or doom-scrolling —',
        `and keep lights-out at ${formatTime(plan.bedtime)}.`,
        left < 20 ? 'Falling asleep may take a little longer than usual; that is normal after a busy evening.' : '',
        ...extras,
      ]
        .filter(Boolean)
        .join(' ');
      out.push({ event, kind: 'short-wind-down', windDownLeftMin: left, lateMeal, lateWorkout, headline, advice });
    }
  }
  return out;
}
