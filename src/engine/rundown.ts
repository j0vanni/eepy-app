/**
 * Bedtime rundown: tonight's evening step by step, from the caffeine cut-off to "I'm in bed", with
 * what to do and why. You choose the steps, their order and length (Settings → Wind-down & phone
 * light → Your bedtime rundown); the times follow tonight's plan (`analysis.tonight`, so "Adjust
 * tonight", "Options for tonight" and "Still up?" move everything). Pure.
 *
 * Two kinds of steps:
 * - Evening: things to be done *by* a time before lights-out — caffeine cut-off (caffeine.ts), last
 *   big meal and hard exercise (tonight's plan), last alcohol, last big drink, dimming the house
 *   lights (when melatonin starts rising, screenLight.ts) and an optional warm shower.
 * - The routine, built backwards from lights-out: the wind-down steps, **phone down**, the
 *   screen-free steps, then lights-out. Phone-down = lights-out − the screen-free steps after it, so
 *   it replaces the old "screens off N min before lights-out" setting while the rundown is on
 *   (`phoneDownAt`; that setting stays the fallback when it's off). The routine fits the wind-down
 *   window (`windDownStart` → lights-out); a longer one is shortened.
 *
 * Short evenings: when the routine doesn't fit — it's longer than tonight's wind-down, or the guided
 * player was started (or fell) behind — optional steps shrink, then drop, in a fixed order
 * (reading first; teeth, phone down and lights-out stay), and `note` says what changed and why.
 *
 * The science, briefly: evening light and screens delay melatonin (and what's on a phone keeps the
 * brain busy as much as its light); caffeine lingers for hours (half-life ~5 h); alcohol fragments
 * the second half of the night; a warm shower 1–2 h before bed speeds falling asleep as the body
 * cools (Haghayegh et al., 2019); writing tomorrow's to-do list helps people fall asleep faster
 * (Scullin et al., 2018); a cool, dark room and a regular routine are cues for sleep; and lying
 * awake in bed for long teaches the brain that bed is for being awake (stimulus control).
 */
import type { CaffeineCutoff } from './caffeine';
import { EReader, eReaderGetUpTip, eReaderIfOn, eReaderReadingLight } from './eReader';
import type { TonightPlan } from './schedule';
import { EVENING_LEAD_MIN } from './screenLight';
import { formatDuration, formatTime, HOUR, MINUTE } from './time';
import { screensOffAt } from './windDownPlan';

/** Reading-time choices (0 = no reading). */
export const READING_OPTIONS = [0, 10, 15, 20, 30, 45, 60] as const;
export const DEFAULT_READING_MIN = 30;
/** The "phone down soon" heads-up comes this long before phone-down. */
export const PHONE_DOWN_SOON_MIN = 10;
/** A warm shower takes about this long. */
export const SHOWER_MIN = 15;

export type RundownPhase = 'evening' | 'winddown' | 'phone-down' | 'screen-free' | 'lights-out';

/** A step you added yourself (Settings → Your bedtime rundown → Add a step). */
export interface CustomRundownStep {
  /** `custom-…` */
  id: string;
  title: string;
  min: number;
  /** No phone or other screen needed (it can come after phone-down). */
  screenFree: boolean;
}

/** Your rundown, as saved in `settings.rundown`. */
export interface RundownSettings {
  /** Off: the plain wind-down timeline, and screens off `screensOffMin` before lights-out. */
  enabled: boolean;
  /** The routine's order, wind-down → lights-out (lights-out itself is always last). */
  order: string[];
  /** Steps switched off. */
  off: string[];
  /** Your minutes where they differ from the default: a routine step's length, an evening step's lead before lights-out. */
  minutes: Record<string, number>;
  /** Reading before lights-out (0 = none). */
  readingMin: number;
  custom: CustomRundownStep[];
  /** Steps with their own reminder when they start. */
  remind: string[];
}

/** Done / Skip in the guided player: when the step came up and when you tapped. */
export interface RundownMark {
  s: 'done' | 'skipped';
  from: number;
  to: number;
}

/** The guided player's progress for one night (`settings.rundownProgress`, keyed by tonight's wakeDate). */
export interface RundownProgress {
  wakeDate: string;
  startedAt: number;
  /** When the current step came up (start, or the last Done / Skip / Back). */
  since: number;
  marks: Record<string, RundownMark>;
}

export interface RundownStep {
  id: string;
  phase: RundownPhase;
  /** By a time (caffeine, meal…), something to do (the routine, the shower), or a moment (phone down, lights out). */
  kind: 'by' | 'do' | 'moment';
  title: string;
  icon: string;
  /** When it starts; for a "by" step, the time to be done by. */
  at: number;
  end: number;
  /** Minutes tonight (0 for a moment or a "by" step). */
  min: number;
  /** Minutes as set, before a short evening shortened it. */
  setMin: number;
  screenFree: boolean;
  /** One line for compact lists. */
  summary: string;
  /** What to do and why. */
  detail: string;
  custom?: boolean;
  /** Can't be switched off (phone down, lights out). */
  required?: boolean;
  shortened?: boolean;
  /** From the guided player. */
  status?: 'done' | 'skipped';
  /** Has its own reminder at `at`. */
  remind?: boolean;
}

export interface Rundown {
  wakeDate: string;
  /** Every step tonight in time order. */
  steps: RundownStep[];
  /** The evening steps (before wind-down), in time order. */
  evening: RundownStep[];
  /** The guided part in order: wind-down steps, phone down, screen-free steps, lights-out. */
  routine: RundownStep[];
  /** When the first routine step starts. */
  start: number;
  phoneDown: number;
  lightsOut: number;
  windDownStart: number;
  /** Routine minutes as set, and tonight. */
  setMin: number;
  plannedMin: number;
  /** Reading tonight (0 = none). */
  readingMin: number;
  shortened: { id: string; title: string; from: number; to: number }[];
  dropped: { id: string; title: string; min: number }[];
  /** On a short evening: why, and what changed. */
  note?: string;
  /** Shortened because the guided player is behind (not because the wind-down is short). */
  late?: boolean;
  /** The guided player is running tonight. */
  playing: boolean;
}

// ─── Steps ──────────────────────────────────────────────────────────────────────────────────────

type Range = { min: number; max: number };

interface StepDef {
  title: string;
  icon: string;
  /** Routine: default minutes. Evening: default lead before lights-out (only `lead` steps). */
  min: number;
  screenFree: boolean;
  /** Routine: the shortest it gets on a short evening. */
  floor?: number;
  /** Short-evening order: lower shrinks first, then drops first. None = kept. */
  rank?: number;
  required?: boolean;
  /** Evening: you can change how long before lights-out. */
  lead?: Range & { step: number };
  /** How it's named in a sentence ("setting up tomorrow is shorter"). */
  noun: string;
}

export type EveningStepId = 'caffeine' | 'dim-lights' | 'meal' | 'alcohol' | 'exercise' | 'fluids' | 'shower';
export type RoutineStepId = 'tomorrow' | 'todo-list' | 'bedroom' | 'alarm' | 'phone-down' | 'teeth' | 'reading' | 'relax';

export const EVENING_STEPS: EveningStepId[] = ['caffeine', 'dim-lights', 'meal', 'alcohol', 'exercise', 'fluids', 'shower'];
/** The default routine (lights-out comes after). Before phone-down 15 min, after it 45 — one hour of wind-down. */
export const DEFAULT_ORDER: RoutineStepId[] = ['tomorrow', 'todo-list', 'bedroom', 'alarm', 'phone-down', 'teeth', 'reading', 'relax'];

const EVENING_DEFS: Record<EveningStepId, StepDef> = {
  caffeine: { title: 'Caffeine cut-off', icon: 'coffee-off-outline', min: 0, screenFree: true, noun: 'the caffeine cut-off' },
  'dim-lights': { title: 'Dim the house lights', icon: 'lightbulb-night-outline', min: EVENING_LEAD_MIN, screenFree: true, noun: 'dimming the lights' },
  meal: { title: 'Last big meal', icon: 'silverware-fork-knife', min: 180, screenFree: true, noun: 'the last big meal' },
  alcohol: { title: 'Last alcohol', icon: 'glass-wine', min: 180, screenFree: true, lead: { min: 60, max: 360, step: 30 }, noun: 'the last drink' },
  exercise: { title: 'Hard exercise done', icon: 'run', min: 120, screenFree: true, noun: 'hard exercise' },
  fluids: { title: 'Last big drink', icon: 'cup-water', min: 120, screenFree: true, lead: { min: 30, max: 180, step: 15 }, noun: 'the last big drink' },
  shower: { title: 'Warm shower or bath', icon: 'shower-head', min: 90, screenFree: true, lead: { min: 45, max: 150, step: 15 }, noun: 'the shower' },
};

const ROUTINE_DEFS: Record<RoutineStepId, StepDef> = {
  tomorrow: { title: 'Set up tomorrow', icon: 'tshirt-crew-outline', min: 5, floor: 3, rank: 2, screenFree: true, noun: 'setting up tomorrow' },
  'todo-list': { title: 'To-do list for tomorrow', icon: 'notebook-edit-outline', min: 5, floor: 3, rank: 5, screenFree: true, noun: 'the to-do list' },
  bedroom: { title: 'Bedroom ready', icon: 'thermometer-low', min: 3, floor: 2, rank: 6, screenFree: true, noun: 'getting the bedroom ready' },
  alarm: { title: 'Alarm & last messages', icon: 'alarm-check', min: 2, floor: 1, rank: 7, screenFree: false, noun: 'the alarm check' },
  'phone-down': { title: 'Phone down', icon: 'cellphone-off', min: 0, screenFree: true, required: true, noun: 'phone down' },
  teeth: { title: 'Teeth & skin care', icon: 'toothbrush-paste', min: 10, floor: 5, screenFree: true, noun: 'teeth & skin care' },
  reading: { title: 'Reading time', icon: 'book-open-page-variant-outline', min: DEFAULT_READING_MIN, floor: 10, rank: 1, screenFree: true, noun: 'reading' },
  relax: { title: 'Relax in bed', icon: 'meditation', min: 5, floor: 3, rank: 3, screenFree: true, noun: 'relaxing in bed' },
};
/** Your own steps shorten and drop after relaxing in bed, before the to-do list. */
const CUSTOM_RANK = 4;
const MINUTES_RANGE: Range = { min: 1, max: 60 };

const isEvening = (id: string): id is EveningStepId => id in EVENING_DEFS;
const isBuiltInRoutine = (id: string): id is RoutineStepId => id in ROUTINE_DEFS;

export const DEFAULT_RUNDOWN: RundownSettings = {
  enabled: true,
  order: [...DEFAULT_ORDER],
  off: [],
  minutes: {},
  readingMin: DEFAULT_READING_MIN,
  custom: [],
  remind: [],
};

/**
 * The saved rundown with defaults filled in (the store's merge). For a store saved before the
 * rundown existed, reading time comes from the old screens-off choice (30 → 15 min, 45 → 30,
 * 60 → 45) so phone-down stays where it was.
 */
export function rundownSettingsFrom(saved: Partial<RundownSettings> | undefined, screensOffMin?: number): RundownSettings {
  if (!saved) {
    const fromScreensOff = screensOffMin !== undefined ? nearestReading(screensOffMin - (ROUTINE_DEFS.teeth.min + ROUTINE_DEFS.relax.min)) : DEFAULT_READING_MIN;
    return { ...DEFAULT_RUNDOWN, order: [...DEFAULT_ORDER], readingMin: fromScreensOff };
  }
  return {
    ...DEFAULT_RUNDOWN,
    ...saved,
    order: Array.isArray(saved.order) ? saved.order : [...DEFAULT_ORDER],
    off: Array.isArray(saved.off) ? saved.off : [],
    minutes: { ...saved.minutes },
    custom: Array.isArray(saved.custom) ? saved.custom : [],
    remind: Array.isArray(saved.remind) ? saved.remind : [],
  };
}

function nearestReading(min: number): number {
  return READING_OPTIONS.reduce((best, o) => (Math.abs(o - min) < Math.abs(best - min) ? o : best), DEFAULT_READING_MIN as number);
}

function customOf(s: RundownSettings, id: string): CustomRundownStep | undefined {
  return s.custom.find((c) => c.id === id);
}

function screenFreeOf(s: RundownSettings, id: string): boolean {
  if (isBuiltInRoutine(id)) return ROUTINE_DEFS[id].screenFree;
  return customOf(s, id)?.screenFree ?? true;
}

/**
 * The routine's order with anything missing or out of place fixed: unknown ids dropped, built-ins
 * a newer version added (or a reset store lacks) put where the defaults have them, your own steps
 * that need a screen moved before phone-down.
 */
export function routineOrder(s: RundownSettings): string[] {
  const known = (id: string) => isBuiltInRoutine(id) || !!customOf(s, id);
  const order = [...new Set(s.order.filter(known))];
  DEFAULT_ORDER.forEach((id, i) => {
    if (order.includes(id)) return;
    const before = DEFAULT_ORDER.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  for (const c of s.custom) if (!order.includes(c.id)) order.splice(c.screenFree ? order.length : order.indexOf('phone-down'), 0, c.id);
  const pd = order.indexOf('phone-down');
  const after = order.slice(pd + 1);
  const needsScreen = after.filter((id) => !screenFreeOf(s, id));
  if (needsScreen.length === 0) return order;
  return [...order.slice(0, pd), ...needsScreen, 'phone-down', ...after.filter((id) => screenFreeOf(s, id))];
}

/** Whether a step is on. Phone down always is; reading is on with a reading time. */
export function rundownStepOn(s: RundownSettings, id: string): boolean {
  if (id === 'phone-down' || id === 'lights-out') return true;
  if (s.off.includes(id)) return false;
  return id !== 'reading' || s.readingMin > 0;
}

/** A step's minutes as set: a routine step's length, or an evening step's lead before lights-out. */
export function rundownStepMinutes(s: RundownSettings, id: string): number {
  if (id === 'reading') return s.readingMin;
  if (id === 'phone-down' || id === 'lights-out') return 0;
  const c = customOf(s, id);
  if (c) return c.min;
  const def = isEvening(id) ? EVENING_DEFS[id] : isBuiltInRoutine(id) ? ROUTINE_DEFS[id] : undefined;
  return s.minutes[id] ?? def?.min ?? 0;
}

/** What the minutes stepper for a step allows (undefined: no stepper — the time comes from the plan, or it's a moment). */
export function rundownMinutesRange(id: string): (Range & { step: number }) | undefined {
  if (isEvening(id)) return EVENING_DEFS[id].lead;
  if (id === 'phone-down' || id === 'lights-out' || id === 'reading') return undefined;
  return { ...MINUTES_RANGE, step: 1 };
}

/** One stepper tap: by a minute up to 10, then by 5 (evening leads by their own step). */
export function nudgeRundownMinutes(id: string, cur: number, dir: 1 | -1): number {
  const range = rundownMinutesRange(id);
  if (!range) return cur;
  const step = isEvening(id) ? range.step : dir > 0 ? (cur < 10 ? 1 : 5) : cur <= 10 ? 1 : 5;
  return Math.max(range.min, Math.min(range.max, cur + dir * step));
}

// ─── Editor reducers (Settings → Your bedtime rundown) ─────────────────────────────────────────

export function toggleRundownStep(s: RundownSettings, id: string, on: boolean): RundownSettings {
  if (id === 'phone-down' || id === 'lights-out') return s;
  if (id === 'reading') return { ...s, off: s.off.filter((x) => x !== id), readingMin: on ? s.readingMin || DEFAULT_READING_MIN : 0 };
  const off = s.off.filter((x) => x !== id);
  return { ...s, off: on ? off : [...off, id] };
}

export function setRundownMinutes(s: RundownSettings, id: string, min: number): RundownSettings {
  const m = Math.round(min);
  if (id === 'reading') return { ...s, readingMin: Math.max(0, Math.min(Math.max(...READING_OPTIONS), m)), off: s.off.filter((x) => x !== 'reading') };
  const range = rundownMinutesRange(id);
  if (!range) return s;
  const clamped = Math.max(range.min, Math.min(range.max, m));
  if (customOf(s, id)) return { ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, min: clamped } : c)) };
  return { ...s, minutes: { ...s.minutes, [id]: clamped } };
}

/** Whether a routine step can move one place earlier (-1) or later (+1): never past lights-out, and nothing needing a screen after phone-down. */
export function canMoveRundownStep(s: RundownSettings, id: string, dir: -1 | 1): boolean {
  const order = routineOrder(s);
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return false;
  const other = order[j];
  if (id === 'phone-down') return dir < 0 || screenFreeOf(s, other);
  if (other === 'phone-down') return dir < 0 || screenFreeOf(s, id);
  return true;
}

export function moveRundownStep(s: RundownSettings, id: string, dir: -1 | 1): RundownSettings {
  if (!canMoveRundownStep(s, id, dir)) return s;
  const order = routineOrder(s);
  const i = order.indexOf(id);
  [order[i], order[i + dir]] = [order[i + dir], order[i]];
  return { ...s, order };
}

/** Adds your own step: screen-free ones just before lights-out, others just before phone-down. */
export function addCustomRundownStep(s: RundownSettings, step: { title: string; min: number; screenFree: boolean }, id: string): RundownSettings {
  const title = step.title.trim().slice(0, 40);
  if (!title) return s;
  const custom: CustomRundownStep = { id, title, min: Math.max(MINUTES_RANGE.min, Math.min(MINUTES_RANGE.max, Math.round(step.min))), screenFree: step.screenFree };
  const next = { ...s, custom: [...s.custom, custom] };
  const order = routineOrder(s);
  order.splice(step.screenFree ? order.length : order.indexOf('phone-down'), 0, id);
  return { ...next, order };
}

export function removeCustomRundownStep(s: RundownSettings, id: string): RundownSettings {
  return { ...s, custom: s.custom.filter((c) => c.id !== id), order: s.order.filter((x) => x !== id), off: s.off.filter((x) => x !== id), remind: s.remind.filter((x) => x !== id) };
}

export function setRundownReminder(s: RundownSettings, id: string, on: boolean): RundownSettings {
  const remind = s.remind.filter((x) => x !== id);
  return { ...s, remind: on ? [...remind, id] : remind };
}

/** Back to the default steps (on or off stays as it is). */
export function resetRundown(s: RundownSettings): RundownSettings {
  return { ...DEFAULT_RUNDOWN, order: [...DEFAULT_ORDER], enabled: s.enabled };
}

/** Steps that can have their own reminder (phone down and lights-out have theirs in Settings → Notifications). */
export function canRemind(id: string): boolean {
  return id !== 'phone-down' && id !== 'lights-out' && id !== 'caffeine';
}

// ─── Laying out the routine ─────────────────────────────────────────────────────────────────────

interface Slot {
  id: string;
  setMin: number;
  floor: number;
  rank?: number;
  screenFree: boolean;
  noun: string;
}

function slotsOf(s: RundownSettings): Slot[] {
  return routineOrder(s)
    .filter((id) => rundownStepOn(s, id))
    .map((id) => {
      const setMin = rundownStepMinutes(s, id);
      const c = customOf(s, id);
      if (c) return { id, setMin, floor: Math.max(1, Math.round(setMin / 2)), rank: CUSTOM_RANK, screenFree: c.screenFree, noun: `“${c.title}”` };
      const def = ROUTINE_DEFS[id as RoutineStepId];
      return { id, setMin, floor: def.floor ?? setMin, rank: def.rank, screenFree: def.screenFree, noun: def.noun };
    });
}

interface Fit {
  len: Map<string, number>;
  shortened: Rundown['shortened'];
  dropped: Rundown['dropped'];
}

/**
 * Fits steps into `budget` minutes: optional steps shorten to their floor in rank order (reading
 * first), then drop in the same order; what the last drop freed goes back to the most important
 * ones; still too long → the kept steps (teeth) shorten too.
 */
function fit(slots: Slot[], budget: number): Fit {
  const len = new Map(slots.map((s) => [s.id, s.setMin]));
  const total = () => [...len.values()].reduce((a, b) => a + b, 0);
  let over = total() - Math.max(0, budget);
  const optional = slots.filter((s) => s.rank !== undefined).sort((a, b) => a.rank! - b.rank!);
  const kept = slots.filter((s) => s.rank === undefined);
  const dropped: Rundown['dropped'] = [];
  if (over > 0) {
    for (const s of optional) {
      if (over <= 0) break;
      const cut = Math.min(over, s.setMin - s.floor);
      if (cut > 0) {
        len.set(s.id, s.setMin - cut);
        over -= cut;
      }
    }
    for (const s of optional) {
      if (over <= 0) break;
      over -= len.get(s.id)!;
      len.delete(s.id);
      dropped.push({ id: s.id, title: s.noun, min: s.setMin });
    }
    for (const s of [...optional].reverse()) {
      if (over >= 0) break;
      const cur = len.get(s.id);
      if (cur === undefined) continue;
      const give = Math.min(-over, s.setMin - cur);
      len.set(s.id, cur + give);
      over += give;
    }
    for (const s of kept) {
      if (over <= 0) break;
      const cut = Math.min(over, s.setMin - s.floor);
      if (cut > 0) {
        len.set(s.id, s.setMin - cut);
        over -= cut;
      }
    }
  }
  const shortened = slots.filter((s) => len.has(s.id) && len.get(s.id)! < s.setMin).map((s) => ({ id: s.id, title: s.noun, from: s.setMin, to: len.get(s.id)! }));
  return { len, shortened, dropped };
}

interface Placed {
  id: string;
  at: number;
  end: number;
  min: number;
  setMin: number;
  screenFree: boolean;
  status?: 'done' | 'skipped';
}

interface RoutinePlan {
  placed: Placed[];
  phoneDown: number;
  lightsOut: number;
  start: number;
  setMin: number;
  plannedMin: number;
  shortened: Rundown['shortened'];
  dropped: Rundown['dropped'];
  note?: string;
  late: boolean;
  playing: boolean;
}

/** Steps placed back to back so the last one ends at `end`. */
function backwards(slots: Slot[], len: Map<string, number>, end: number): Placed[] {
  const out: Placed[] = [];
  let t = end;
  for (const s of [...slots].reverse()) {
    const min = len.get(s.id);
    if (min === undefined) continue;
    out.unshift({ id: s.id, at: t - min * MINUTE, end: t, min, setMin: s.setMin, screenFree: s.screenFree });
    t -= min * MINUTE;
  }
  return out;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function noteFor(why: string, shortened: Rundown['shortened'], dropped: Rundown['dropped']): string | undefined {
  if (shortened.length === 0 && dropped.length === 0) return undefined;
  const parts: string[] = [];
  const reading = shortened.find((x) => x.id === 'reading');
  if (reading) parts.push(`reading is ${reading.to} min instead of ${reading.from}`);
  const others = shortened.filter((x) => x.id !== 'reading');
  if (others.length) parts.push(`${list(others.map((x) => x.title))} ${others.length > 1 ? 'are' : 'is'} shorter`);
  if (dropped.length) parts.push(`${list(dropped.map((x) => x.title))} ${dropped.length > 1 ? 'are' : 'is'} skipped`);
  return `${why}, so ${list(parts)}.`;
}

/** Tonight's routine times — with the guided player's progress, the steps still to do fit the time left from the last tap. */
function planRoutine(t: Pick<TonightPlan, 'bedtime' | 'windDownStart' | 'wakeDate'>, s: RundownSettings, progress?: RundownProgress, now?: number): RoutinePlan {
  const slots = slotsOf(s);
  const windowMin = Math.max(0, Math.floor((t.bedtime - t.windDownStart) / MINUTE));
  const setMin = slots.reduce((a, x) => a + x.setMin, 0);
  const p = progress && progress.wakeDate === t.wakeDate ? progress : undefined;

  let placed: Placed[];
  let fitted: Fit;
  let why: string;
  let late = false;
  if (!p) {
    fitted = fit(slots, windowMin);
    placed = backwards(slots, fitted.len, t.bedtime);
    why = `Your rundown takes ${formatDuration(setMin)} but tonight's wind-down is ${formatDuration(windowMin)}`;
  } else {
    const remaining = slots.filter((x) => !p.marks[x.id]);
    const from = Math.max(t.windDownStart, Math.min(p.since, now ?? p.since));
    const budget = Math.max(0, Math.floor((t.bedtime - from) / MINUTE));
    fitted = fit(remaining, budget);
    const ahead = backwards(remaining, fitted.len, t.bedtime);
    // Once the phone is down nobody taps Done: the screen-free steps move on by the clock.
    const byClock = !!p.marks['phone-down'] && now !== undefined;
    placed = slots.flatMap((x): Placed[] => {
      const m = p.marks[x.id];
      if (m) return [{ id: x.id, at: m.from, end: m.to, min: Math.max(0, Math.round((m.to - m.from) / MINUTE)), setMin: x.setMin, screenFree: x.screenFree, status: m.s }];
      const step = ahead.find((a) => a.id === x.id);
      if (!step) return [];
      return [byClock && step.end <= now! ? { ...step, status: 'done' } : step];
    });
    late = fitted.shortened.length + fitted.dropped.length > 0 && budget < windowMin;
    why = late ? `Only ${formatDuration(budget)} left before lights-out` : `Your rundown takes ${formatDuration(setMin)} but tonight's wind-down is ${formatDuration(windowMin)}`;
  }
  const pdStep = placed.find((x) => x.id === 'phone-down');
  const phoneDown = pdStep ? (pdStep.status ? pdStep.end : pdStep.at) : t.bedtime;
  const plannedMin = placed.reduce((a, x) => a + x.min, 0);
  return {
    placed,
    phoneDown,
    lightsOut: t.bedtime,
    start: placed[0]?.at ?? t.bedtime,
    setMin,
    plannedMin,
    shortened: fitted.shortened,
    dropped: fitted.dropped,
    note: noteFor(why, fitted.shortened, fitted.dropped),
    late,
    playing: !!p,
  };
}

/**
 * When the phone goes down tonight: with the rundown on, lights-out minus its screen-free steps;
 * off, the old "screens off N min before lights-out" setting. Never before wind-down starts.
 * The reminders and the phone-light plan use this.
 */
export function phoneDownAt(t: Pick<TonightPlan, 'bedtime' | 'windDownStart' | 'wakeDate'>, s: { rundown?: RundownSettings; screensOffMin: number }): number {
  if (!s.rundown?.enabled) return screensOffAt(t, s.screensOffMin);
  return Math.max(t.windDownStart, planRoutine(t, s.rundown).phoneDown);
}

// ─── What each step says ────────────────────────────────────────────────────────────────────────

/** What the rundown needs from the analysis (`analysis.tonight` is already adjusted for tonight). */
export interface RundownAnalysis {
  tonight: TonightPlan;
  alarm?: { alarm: number; cycles: number; onBoundary: boolean };
  caffeine?: { cutoff: CaffeineCutoff };
}

/** What the rundown needs from app state (AppState fits). */
export interface RundownState {
  settings: {
    rundown: RundownSettings;
    rundownProgress?: RundownProgress;
    screensOffMin: number;
    eReader?: { enabled: boolean; warmLight: boolean };
    sleepMode?: { enabled: boolean; startAt: 'winddown' | 'lightsout' };
    screenDim?: boolean;
    inBedSounds?: boolean;
    notifications?: { smartAlarm?: boolean };
  };
  profile: { caffeineHalfLifeH: number; caffeineBedtimeLimitMg: number; insomniaMode?: boolean };
  cbti?: { active: boolean };
}

interface Ctx {
  t: TonightPlan;
  a: RundownAnalysis;
  st: RundownState;
  e?: EReader;
  phoneDown: number;
  readingMin: number;
}

interface Text {
  title: string;
  icon: string;
  summary: string;
  detail: string;
}

const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

function alarmLine(c: Ctx): string {
  const { t, a, st } = c;
  if (t.noAlarm) return 'No alarm tomorrow — a free day, so wake up when you wake up.';
  const two = t.twoStep;
  if (st.settings.notifications?.smartAlarm) {
    if (two) return `eepy rings your routine alarm around ${formatTime(two.firstAlarm)} (end of a sleep cycle, never after ${formatTime(two.firstWake)}) and the final one at ${formatTime(t.wake)}.`;
    if (a.alarm) return `eepy rings at ${formatTime(a.alarm.alarm)}${a.alarm.onBoundary ? ` — the end of sleep cycle ${a.alarm.cycles}` : ''}, never after ${formatTime(t.wake)}.`;
    return `eepy rings by ${formatTime(t.wake)}.`;
  }
  if (two) return `eepy's alarm is off: check yours is set for your ${formatTime(two.firstWake)} routine and ${formatTime(t.wake)}.`;
  const best = a.alarm?.onBoundary && a.alarm.alarm < t.wake ? ` (${formatTime(a.alarm.alarm)} is the end of a sleep cycle)` : '';
  return `eepy's alarm is off: check yours is set for ${formatTime(t.wake)}${best}.`;
}

function eepyAtPhoneDown(c: Ctx): string {
  const sm = c.st.settings.sleepMode;
  const bits: string[] = [];
  if (c.st.settings.screenDim) bits.push('eepy dims itself to its night level');
  if (sm?.enabled) bits.push(sm.startAt === 'winddown' ? `sleep mode stays on (since ${formatTime(c.t.windDownStart)})` : `bedtime autopilot switches sleep mode on at ${formatTime(c.t.bedtime)}`);
  bits.push('sleep sounds keep playing with the screen off');
  const tip = sm?.enabled ? '' : ' Tip: bedtime autopilot (Settings → Wind-down & phone light) can switch sleep mode on for you.';
  return `What eepy does now: ${bits.join('; ')}.${tip}`;
}

/** "3 h", "2½ h", "45 min". */
function leadText(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 60 === 0) return `${min / 60} h`;
  if (min % 30 === 0) return `${Math.floor(min / 60)}½ h`;
  return formatDuration(min);
}

function eveningText(id: EveningStepId, c: Ctx): Text | undefined {
  const { a, st } = c;
  const def = EVENING_DEFS[id];
  const base = { title: def.title, icon: def.icon };
  switch (id) {
    case 'caffeine': {
      const cut = a.caffeine?.cutoff;
      if (!cut) return undefined;
      const h = st.profile.caffeineHalfLifeH;
      if (cut.overLimit) {
        return {
          ...base,
          title: 'No more caffeine today',
          summary: `~${Math.round(cut.atBedtimeMg)} mg already at bedtime`,
          detail: `About ${Math.round(cut.atBedtimeMg)} mg of caffeine will still be in your system at lights-out — over your ${st.profile.caffeineBedtimeLimitMg} mg limit. Decaf or herbal tea from here: caffeine cuts deep sleep even when you fall asleep fine.`,
        };
      }
      if (cut.cutoff === undefined) return undefined;
      return {
        ...base,
        summary: 'Decaf or herbal tea after this',
        detail: `A ${cut.doseMg} mg coffee after ${formatTime(cut.cutoff)} would leave more than ${st.profile.caffeineBedtimeLimitMg} mg in your system in the first hours of sleep — caffeine's half-life for you is ~${h} h. It cuts deep sleep even when you fall asleep fine.`,
      };
    }
    case 'dim-lights':
      return {
        ...base,
        summary: 'Lamps instead of ceiling lights, Night Light on',
        detail:
          'Melatonin starts rising 2–3 h before you usually fall asleep, and ordinary room light holds it back. Overhead lights off, a few warm, low lamps on; on the phone, Night Light on and brightness at half or less.',
      };
    case 'meal':
      return {
        ...base,
        summary: 'A light snack later is fine',
        detail:
          'Finish big meals about 3 h before lights-out: digesting keeps heart rate and body temperature up, and lying down full invites heartburn. Hungry later? A light snack (yoghurt, a banana, toast) is fine.',
      };
    case 'alcohol':
      return {
        ...base,
        summary: 'If you drink tonight, stop here',
        detail: `Alcohol helps you nod off but breaks up the second half of the night and cuts REM sleep. Stopping ${leadText(rundownStepMinutes(st.settings.rundown, id))} before lights-out gives your body time to clear a drink or two (roughly one an hour).`,
      };
    case 'exercise':
      return {
        ...base,
        summary: 'A walk or stretching is fine after',
        detail: 'Hard workouts within ~2 h of bed keep heart rate and body temperature up for some people. A walk or gentle stretching after this is fine — and helps.',
      };
    case 'fluids':
      return {
        ...base,
        summary: 'Sips only from here',
        detail:
          'A big drink in the last 1–2 h is a common reason to wake up for the bathroom at night — tea, coffee and alcohol make it worse. Sips are fine; go once more just before bed.',
      };
    case 'shower':
      return {
        ...base,
        summary: `${SHOWER_MIN} min, warm — not hot`,
        detail: `A warm shower or bath (${SHOWER_MIN} min) draws heat to your skin, so your core cools faster afterwards — the same drop that starts sleep. Done 1–2 h before bed it helped people fall asleep about 10 min faster (Haghayegh et al., 2019). Skip it if you shower in the morning.`,
      };
  }
}

/** `end`: when the step ends tonight (reading: "until …"). */
function routineText(id: string, c: Ctx, s: RundownSettings, end: number): Text {
  const { t, e, st } = c;
  const custom = customOf(s, id);
  if (custom) {
    return {
      title: custom.title,
      icon: custom.screenFree ? 'star-outline' : 'cellphone',
      summary: custom.screenFree ? 'Your own step · screen-free' : 'Your own step',
      detail: custom.screenFree ? 'Your own step — no screens needed.' : 'Your own step. It needs a screen, so it comes before phone-down.',
    };
  }
  const def = ROUTINE_DEFS[id as RoutineStepId];
  const base = { title: def.title, icon: def.icon };
  const two = t.twoStep;
  const insomnia = !!st.profile.insomniaMode || !!st.cbti?.active;
  switch (id as RoutineStepId) {
    case 'tomorrow':
      return {
        ...base,
        summary: two ? `Clothes, bag — and your ${formatTime(two.firstWake)} routine things` : 'Clothes, bag, keys laid out',
        detail: two
          ? `Clothes, bag and keys laid out — and your ${formatTime(two.firstWake)} routine things (cleanser, towel, moisturiser) ready by the sink, so the routine is quick, done in low light, and you're back in bed fast. Fewer decisions in the morning, less to run through in bed.`
          : 'Clothes, bag, keys and anything for the morning laid out — fewer decisions tomorrow, and less to run through in your head in bed.',
      };
    case 'todo-list':
      return {
        ...base,
        summary: 'On paper — and anything on your mind',
        detail:
          "A few minutes on paper: tomorrow's to-dos, and anything that's on your mind. In a sleep-lab study, people who wrote a specific to-do list fell asleep about 9 min faster than people who wrote about what they'd already done (Scullin et al., 2018) — once it's written down, your brain stops rehearsing it.",
      };
    case 'bedroom':
      return {
        ...base,
        summary: 'Cool 18–20 °C, dark, fan or sounds',
        detail:
          'Cool (about 18–20 °C / 64–68 °F), dark (curtains closed, bright LEDs covered) and quiet — a fan or sleep sounds mask noises. Your core temperature has to drop for you to fall asleep, and a cool room helps it.',
      };
    case 'alarm':
      return {
        ...base,
        summary: 'Then the phone goes down',
        detail: `${alarmLine(c)} Send any last messages now — at ${formatTime(c.phoneDown)} the phone goes down.`,
      };
    case 'phone-down':
      return {
        ...base,
        summary: e ? 'Charger across the room — e-reader is fine' : 'Charger across the room, face down',
        detail: join(
          'Phone on the charger across the room, face down — out of reach, so "just checking" can\'t turn into scrolling. What\'s on a screen keeps your brain busy as much as its light holds back melatonin.',
          e ? `Phone, tablet, TV and laptop off — your e-reader is fine (frontlight low${e.warmLight ? ' and warm' : ''}).` : 'TV, laptop and tablet off too.',
          eepyAtPhoneDown(c),
        ),
      };
    case 'teeth':
      return {
        ...base,
        summary: 'In low light',
        detail:
          "Brush, floss and evening skin care — with the bathroom light low (a night-light or one lamp, not the bright mirror light). A blast of bright light right before bed tells your body clock it's still day.",
      };
    case 'reading': {
      const where = insomnia
        ? 'Read in another room — your insomnia programme keeps the bed for sleep.'
        : 'Somewhere comfy — a chair or the sofa, not in bed if you often lie awake, so the bed stays for sleep.';
      const late = t.gradual ? " Your body clock is still running late: not sleepy by lights-out? Keep reading in dim light rather than lying awake." : '';
      return e
        ? {
            title: 'Read on your e-reader',
            icon: 'book-open-variant',
            summary: `Frontlight low${e.warmLight ? ' and warm' : ''} · until ${formatTime(end)}`,
            detail: `${where} ${eReaderReadingLight(e)} Books only — no browser or apps. Something calm beats a page-turner.${late}`,
          }
        : {
            title: 'Read a paper book',
            icon: 'book-open-page-variant-outline',
            summary: `Under a dim, warm lamp · until ${formatTime(end)}`,
            detail: `${where} A paper book under a dim, warm lamp — printed pages don't hold back melatonin the way a phone or tablet does (Chang et al., 2015). Something calm beats a page-turner.${late}`,
          };
    }
    case 'relax':
      return {
        ...base,
        summary: 'Slow breathing or a body scan',
        detail:
          'In bed with the lights low: a few minutes of slow breathing — in for 4, out for 6 — or a body scan, relaxing each part from your toes up. Slow breathing lowers heart rate and quiets the day\'s thoughts. The wind-down screen has a breathing guide.',
      };
  }
}

function lightsOutText(c: Ctx): Text {
  const { t, e, st } = c;
  const sm = st.settings.sleepMode?.enabled;
  const sounds = st.settings.inBedSounds !== false;
  const starts = [sm ? ', switches sleep mode on' : '', sounds ? ', starts your sleep sounds' : ''].join('');
  const getUp = e
    ? `Not sleepy after ~20 min? ${eReaderGetUpTip(e)}`
    : "Not sleepy after ~20 min? Get up, sit somewhere dim and read until you're sleepy, then go back to bed — lying awake teaches your brain that bed means awake.";
  const two = t.twoStep ? ` At ${formatTime(t.twoStep.firstAlarm)}: your routine in low light, then straight back to bed until ${formatTime(t.wake)}.` : '';
  return {
    title: 'Lights out',
    icon: 'sleep',
    summary: `Tap "I'm in bed"`,
    detail: `${c.readingMin > 0 ? `${e ? 'E-reader' : 'Book'} down, light off. ` : 'Light off. '}Tap "I'm in bed": eepy times your alarm from that moment${starts} and keeps tonight's reminders quiet. Dark, cool, quiet. ${getUp}${two}`,
  };
}

// ─── Tonight's rundown ──────────────────────────────────────────────────────────────────────────

/** The guided player's progress if it belongs to this night. */
export function progressFor(p: RundownProgress | undefined, wakeDate: string): RundownProgress | undefined {
  return p && p.wakeDate === wakeDate ? p : undefined;
}

/**
 * Tonight's rundown, or undefined when it's switched off. With `now` and the guided player's
 * progress for tonight, the steps still to do fit the time left (a late start shortens them).
 */
export function rundownFor(a: RundownAnalysis, st: RundownState, now?: number): Rundown | undefined {
  const s = st.settings.rundown;
  if (!s?.enabled) return undefined;
  const t = a.tonight;
  const progress = progressFor(st.settings.rundownProgress, t.wakeDate);
  const plan = planRoutine(t, s, progress, now);
  const phoneDown = Math.max(t.windDownStart, plan.phoneDown);
  const readingMin = plan.placed.find((x) => x.id === 'reading')?.min ?? 0;
  const c: Ctx = { t, a, st, e: eReaderIfOn(st.settings.eReader), phoneDown, readingMin };
  const remind = new Set(s.remind);

  const evening: RundownStep[] = [];
  for (const id of EVENING_STEPS) {
    if (!rundownStepOn(s, id)) continue;
    const text = eveningText(id, c);
    if (!text) continue;
    let at: number;
    if (id === 'caffeine') at = a.caffeine!.cutoff.cutoff ?? t.bedtime - 8 * HOUR;
    else if (id === 'dim-lights') at = Math.min(t.bedtime - EVENING_LEAD_MIN * MINUTE, t.windDownStart);
    else if (id === 'meal') at = t.lastMeal;
    else if (id === 'exercise') at = t.lastExercise;
    else at = t.bedtime - rundownStepMinutes(s, id) * MINUTE;
    const lasts = id === 'shower' ? SHOWER_MIN : 0;
    evening.push({
      id,
      phase: 'evening',
      kind: id === 'shower' ? 'do' : id === 'dim-lights' ? 'moment' : 'by',
      ...text,
      at,
      end: at + lasts * MINUTE,
      min: lasts,
      setMin: lasts,
      screenFree: true,
      remind: remind.has(id) && canRemind(id),
    });
  }
  evening.sort((x, y) => x.at - y.at);

  const pdIndex = plan.placed.findIndex((x) => x.id === 'phone-down');
  const routine: RundownStep[] = plan.placed.map((p, i) => {
    const text = routineText(p.id, c, s, p.end);
    const phase: RundownPhase = p.id === 'phone-down' ? 'phone-down' : i < pdIndex ? 'winddown' : 'screen-free';
    return {
      id: p.id,
      phase,
      kind: p.id === 'phone-down' ? 'moment' : 'do',
      ...text,
      at: p.at,
      end: p.end,
      min: p.min,
      setMin: p.setMin,
      screenFree: p.screenFree,
      ...(customOf(s, p.id) ? { custom: true } : {}),
      ...(p.id === 'phone-down' ? { required: true } : {}),
      ...(!p.status && p.min < p.setMin ? { shortened: true } : {}),
      ...(p.status ? { status: p.status } : {}),
      remind: remind.has(p.id) && canRemind(p.id),
    };
  });
  const lightsMark = progress?.marks['lights-out'];
  routine.push({
    id: 'lights-out',
    phase: 'lights-out',
    kind: 'moment',
    ...lightsOutText(c),
    at: t.bedtime,
    end: t.bedtime,
    min: 0,
    setMin: 0,
    screenFree: true,
    required: true,
    ...(lightsMark ? { status: lightsMark.s } : {}),
  });

  return {
    wakeDate: t.wakeDate,
    // Same time: the evening step first, otherwise as they are.
    steps: [...evening, ...routine].sort((x, y) => x.at - y.at || Number(y.phase === 'evening') - Number(x.phase === 'evening')),
    evening,
    routine,
    start: plan.start,
    phoneDown,
    lightsOut: t.bedtime,
    windDownStart: t.windDownStart,
    setMin: plan.setMin,
    plannedMin: plan.plannedMin,
    readingMin,
    shortened: plan.shortened,
    dropped: plan.dropped,
    ...(plan.note ? { note: plan.note } : {}),
    ...(plan.late ? { late: true } : {}),
    playing: plan.playing,
  };
}

// ─── Settings → Your bedtime rundown ────────────────────────────────────────────────────────────

/** One step in the editor, on or off, with tonight's time when it's on. */
export interface RundownCatalogItem {
  id: string;
  group: 'evening' | 'routine';
  kind: RundownStep['kind'];
  title: string;
  icon: string;
  summary: string;
  detail: string;
  on: boolean;
  required: boolean;
  custom: boolean;
  screenFree: boolean;
  /** Minutes as set: a routine step's length, or an evening step's lead before lights-out. */
  min: number;
  /** The minutes stepper (none: the time comes from the plan, or it's a moment). */
  range?: Range & { step: number };
  /** Evening steps without a stepper: where their time comes from. */
  from?: string;
  remind: boolean;
  canRemind: boolean;
  canUp: boolean;
  canDown: boolean;
  /** Tonight's time (when it's on and there's a plan). */
  at?: number;
}

const EVENING_FROM: Partial<Record<EveningStepId, string>> = {
  caffeine: 'From your caffeine half-life and limit',
  'dim-lights': 'When melatonin starts rising (~3 h before lights-out)',
  meal: '3 h before lights-out',
  exercise: '2 h before lights-out',
};

/** A night to word the steps with when there's no plan yet (times aren't shown then). */
function placeholderTonight(): TonightPlan {
  const bed = Date.UTC(2026, 0, 1, 23);
  return { wakeDate: '2026-01-02', isWorkday: true, wake: bed + 8 * HOUR, bedtime: bed, windDownStart: bed - HOUR, lastMeal: bed - 3 * HOUR, lastExercise: bed - 2 * HOUR, inBedMin: 480, extraForDebtMin: 0, gradual: false, rationale: [] };
}

/** Every step for the editor — evening steps, then the routine in its order — with their words and tonight's times. */
export function rundownCatalog(a: RundownAnalysis | undefined, st: RundownState): { evening: RundownCatalogItem[]; routine: RundownCatalogItem[] } {
  const s = st.settings.rundown;
  const base: RundownAnalysis = a ?? { tonight: placeholderTonight() };
  const plain = { ...st.settings, rundownProgress: undefined };
  // Tonight's times (as set), and the words for every step (all of them on).
  const tonight = a ? rundownFor(a, { ...st, settings: { ...plain, rundown: { ...s, enabled: true } } }) : undefined;
  const allOn = rundownFor(base, { ...st, settings: { ...plain, rundown: { ...s, enabled: true, off: [], readingMin: s.readingMin || DEFAULT_READING_MIN } } })!;
  const words = new Map([...allOn.steps].map((x) => [x.id, x]));
  const times = new Map((tonight?.steps ?? []).map((x) => [x.id, x.at]));
  const remind = new Set(s.remind);

  const evening = EVENING_STEPS.map((id): RundownCatalogItem => {
    const w = words.get(id);
    const def = EVENING_DEFS[id];
    return {
      id,
      group: 'evening',
      kind: w?.kind ?? 'by',
      title: w?.title ?? def.title,
      icon: def.icon,
      summary: w?.summary ?? 'From the drinks you log',
      detail: w?.detail ?? "Log your coffee and tea (Today → Log coffee) and eepy works out when your last one should be so little is left at bedtime — caffeine's half-life is about 5 h.",
      on: rundownStepOn(s, id),
      required: false,
      custom: false,
      screenFree: true,
      min: rundownStepMinutes(s, id),
      ...(def.lead ? { range: def.lead } : { from: EVENING_FROM[id] }),
      remind: remind.has(id) && canRemind(id),
      canRemind: canRemind(id),
      canUp: false,
      canDown: false,
      ...(times.has(id) ? { at: times.get(id) } : {}),
    };
  });
  const routine = [...routineOrder(s), 'lights-out'].map((id): RundownCatalogItem => {
    const w = words.get(id)!;
    const c = customOf(s, id);
    return {
      id,
      group: 'routine',
      kind: w.kind,
      title: id === 'reading' ? 'Reading time' : w.title,
      icon: w.icon,
      summary: w.summary,
      detail: w.detail,
      on: rundownStepOn(s, id),
      required: id === 'phone-down' || id === 'lights-out',
      custom: !!c,
      screenFree: id === 'lights-out' || screenFreeOf(s, id),
      min: rundownStepMinutes(s, id),
      ...(rundownMinutesRange(id) ? { range: rundownMinutesRange(id) } : {}),
      remind: remind.has(id) && canRemind(id),
      canRemind: canRemind(id),
      canUp: id !== 'lights-out' && canMoveRundownStep(s, id, -1),
      canDown: id !== 'lights-out' && canMoveRundownStep(s, id, 1),
      ...(times.has(id) ? { at: times.get(id) } : {}),
    };
  });
  return { evening, routine };
}

/** "Phone down 10:30 PM · read 30 min · lights out 11:15 PM" — tonight at a glance. */
export function rundownGlance(r: Rundown): string {
  return [`Phone down ${formatTime(r.phoneDown)}`, r.readingMin > 0 ? `read ${r.readingMin} min` : '', `lights out ${formatTime(r.lightsOut)}`].filter(Boolean).join(' · ');
}

/** The screen-free stretch after phone-down in words: "teeth & skin care, 30 min of reading and relaxing in bed". */
export function screenFreeSummary(r: Rundown): string {
  const after = r.routine.filter((x) => x.phase === 'screen-free');
  return list(after.map((x) => (x.id === 'reading' ? `${x.min} min of reading` : x.custom ? x.title : (ROUTINE_DEFS[x.id as RoutineStepId]?.noun ?? x.title))));
}

/**
 * What's happening now: with the guided player, its current step (the first not done or skipped);
 * otherwise the evening activity under way or the latest routine step that has started. `next` is
 * the step after it (or the next one coming up).
 */
export function rundownNow(r: Rundown, now: number): { current?: RundownStep; next?: RundownStep } {
  if (r.playing) {
    const i = r.routine.findIndex((x) => !x.status);
    return i < 0 ? {} : { current: r.routine[i], next: r.routine[i + 1] };
  }
  const evening = r.evening.find((x) => x.kind === 'do' && x.at <= now && now < x.end);
  const started = r.routine.filter((x) => x.at <= now);
  const current = evening ?? (now < r.lightsOut + HOUR ? started[started.length - 1] : undefined);
  const next = r.steps.find((x) => x.at > now && x !== current);
  return { current, next };
}

// ─── The guided player ──────────────────────────────────────────────────────────────────────────

export interface PlayerPosition {
  /** Index into `routine` of the current step (= routine.length once everything is done). */
  index: number;
  step?: RundownStep;
  total: number;
  /** Steps done or skipped. */
  marked: number;
}

export function playerPosition(r: Rundown): PlayerPosition {
  const i = r.routine.findIndex((x) => !x.status);
  const index = i < 0 ? r.routine.length : i;
  return { index, step: r.routine[index], total: r.routine.length, marked: r.routine.filter((x) => x.status).length };
}

/**
 * "Start my rundown". `pickUp`: you've been following along without it — steps already over by
 * the clock count as done-ish (skipped), and it starts at the one happening now.
 */
export function startRundownProgress(r: Rundown, now: number, pickUp = false): RundownProgress {
  const marks: Record<string, RundownMark> = {};
  if (pickUp) for (const x of r.routine) if (x.id !== 'lights-out' && x.end <= now) marks[x.id] = { s: 'skipped', from: x.at, to: x.end };
  return { wakeDate: r.wakeDate, startedAt: now, since: now, marks };
}

/** Done / Skip on the current step. */
export function markRundownStep(p: RundownProgress, id: string, s: 'done' | 'skipped', now: number): RundownProgress {
  return { ...p, since: now, marks: { ...p.marks, [id]: { s, from: p.since, to: now } } };
}

/** Back: the step before the current one comes up again. */
export function backRundownStep(p: RundownProgress, r: Rundown, now: number): RundownProgress {
  const { index } = playerPosition(r);
  const prev = r.routine
    .slice(0, index)
    .reverse()
    .find((x) => p.marks[x.id]);
  if (!prev) return p;
  const marks = { ...p.marks };
  delete marks[prev.id];
  return { ...p, since: now, marks };
}

/** Whether "pick up from now" makes sense: the clock is past the first routine step. */
export function canPickUp(r: Rundown, now: number): boolean {
  const first = r.routine[0];
  return !r.playing && !!first && first.id !== 'lights-out' && now >= first.end && now < r.lightsOut;
}
