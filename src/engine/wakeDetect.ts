/**
 * When you really fell asleep, woke up and got up — and what happened in between.
 *
 * Watches and phone "sleep" modes keep recording after you're up (you didn't stop it, the phone's
 * bedtime mode was still on, you lay still in bed), and can start long before you fall asleep. Each
 * main sleep is corrected here before any model sees it: analysis, calibration and export all go
 * through {@link correctedMetrics}, so need, debt, scores, chronotype, regularity and insights use
 * the corrected night.
 *
 * Evidence that you were awake
 * - Interactions (strong): eepy on screen (`wakeLog.use`, from an AppState listener), "I'm up" on the
 *   wake alarm (`wakeLog.ups`; the native alarm's "I'm up" opens eepy, so it lands in `use`),
 *   check-ins / ping answers, journal sleepiness ratings.
 * - Caffeine logs (supporting only): drinks are often logged afterwards, or at the "usual" time.
 * - Steps from Health Connect (`NightVitals.stepCurve`, 10-min bins).
 * - Heart rate (`NightVitals.hrCurve`, supporting only — it never moves a boundary by itself).
 * - The night's own stages: deep or REM sleep is "real sleep"; light sleep is what a watch also
 *   reports for someone lying still and awake.
 *
 * Rules (numbers in {@link WAKE_RULES})
 * Got up / final wake
 *  1. Candidates are interactions and step bursts (≥ 100 steps within 20 min, starting with a bin of
 *     ≥ 20 steps) at least 3 h after sleep onset and at least 10 min before the recorded end.
 *  2. A candidate is ignored when the watch shows ≥ 5 min of deep or REM sleep after it: you went back
 *     to sleep (snoozed, or checked the phone at 6:00 and slept on until 7:30).
 *  3. On nights without stages (nothing to tell real sleep from lying still) an interaction also needs
 *     corroboration within 60 min after it: another interaction, ≥ 20 steps or a heart-rate rise.
 *     A step burst stands on its own.
 *  4. The earliest remaining candidate is when you got up. The recording is cut there — never before
 *     the end of the last deep/REM segment — when that removes ≥ 10 min; otherwise nothing changes.
 *  5. "Woke up" (final wake, used for sleep metrics) is the end of the last sleep before that;
 *     "got up" (out of bed) ends the time in bed, which efficiency uses.
 *  6. A heart-rate rise (≥ 8 bpm over the night's median for ~20 min), caffeine and a second kind of
 *     evidence only raise confidence.
 * Falling asleep
 *  7. Interactions or a bin of ≥ 20 steps after the recorded sleep onset show you were still awake;
 *     the latest of them (eepy use: when you put it down) becomes sleep onset when that is ≥ 10 min
 *     later. Onset never passes the first deep/REM segment and moves at most 3 h (60 min on nights
 *     without stages). The time before stays in bed, awake (latency), so efficiency sees it.
 *  8. A long light stretch before the first deep sleep (≥ 45 min) or a heart rate still ≥ 12 bpm over
 *     the night's median in the first 30 min only lower confidence in the recorded onset.
 * During the night
 *  9. Awake stretches between sleep onset and final wake are wake-ups; stretches less than 3 min of
 *     sleep apart are one. Using eepy in the middle of the night (with more sleep after it) marks
 *     those minutes awake (at least 2, at most 45). A wake-up is listed from 5 min, or at any length
 *     when you got up (≥ 20 steps during it) or used eepy.
 * Always
 * 10. Naps and manual logs (you typed those times) are never changed. Your own correction
 *     (`wakeLog.fixes`) always wins; "Looks right" keeps what eepy worked out.
 * 11. Nothing detected, but a wake-up ≥ 90 min later than usual for that kind of day: eepy asks.
 */
import { analyzeSessions, computeSessionMetrics, SessionAnalyzeOptions, SessionMetrics } from './sessions';
import { mean, median } from './stats';
import { circularMeanMinutes, clockDiff, DAY, HOUR, MINUTE, minutesOfDay, weekdayOfKey } from './time';
import type { NightFix, NightVitals, Profile, SleepDataset, SleepSession, Stage, StageSegment, WakeLog } from './types';

export const WAKE_RULES = {
  /** Deep + REM minutes after a sign of being up that mean you went back to sleep. */
  backToSleepMin: 5,
  /** Steps within `burstWindowMin` that mean you were up and about. */
  burstSteps: 100,
  burstWindowMin: 20,
  /** Steps in one 10-min bin that count as being on your feet. */
  upSteps: 20,
  /** Smallest change worth making to a recorded boundary. */
  minChangeMin: 10,
  /** Signs of being up earlier than this after sleep onset are night-time awakenings, not the morning. */
  minSleepBeforeWakeMin: 180,
  /** How far onset may move on staged nights (and never past the first deep/REM). */
  onsetWindowMin: 180,
  /** … and on nights without stages. */
  onsetWindowUnstagedMin: 60,
  /** A light stretch this long before the first deep sleep makes the recorded onset doubtful. */
  longLightMin: 45,
  /** Corroboration window for interactions on nights without stages. */
  corroborateMin: 60,
  /** Heart rate this far above the night's median around a sign of being up confirms it. */
  hrRiseBpm: 8,
  /** Heart rate this far above the night's median after the recorded onset: probably not asleep yet. */
  hrAwakeBpm: 12,
  /** A night awakening is listed from this long (or when you got up / used eepy). */
  episodeMin: 5,
  /** Awake stretches separated by less sleep than this are one wake-up. */
  episodeMergeMin: 3,
  /** eepy use during the night counts as awake for at least / at most this long. */
  useMinMin: 2,
  useMaxMin: 45,
  /** Ask when the wake-up is this much later than usual for that kind of day. */
  askLateMin: 90,
} as const;

/** Days of app use / alarm taps kept (corrections are kept for good). */
export const WAKE_LOG_DAYS = 60;

export const EMPTY_WAKE_LOG: WakeLog = { detect: true, use: [], ups: [], fixes: {} };

// ---------------------------------------------------------------------------
// The log (pure reducers; the store and the AppState listener call these)
// ---------------------------------------------------------------------------

/** The part of the day eepy remembers app use for: evenings, nights and mornings (19:00–13:00). */
export function inUseWindow(t: number): boolean {
  const m = minutesOfDay(t);
  return m >= 19 * 60 || m < 13 * 60;
}

const MERGE_USE_MS = 5 * MINUTE;

/** Records eepy being on screen from `start` to `end` (the same `start` again extends it). Returns `log` itself when nothing changes. */
export function logAppUse(log: WakeLog, start: number, end: number, now = end): WakeLog {
  if (end < start) end = start;
  if (!inUseWindow(start) && !inUseWindow(end) && end - start < 6 * HOUR) return log;
  const use = log.use.filter(([, e]) => e >= now - WAKE_LOG_DAYS * DAY);
  const i = use.findIndex(([s, e]) => start <= e + MERGE_USE_MS && end >= s - MERGE_USE_MS);
  if (i >= 0) {
    const [s, e] = use[i];
    const merged: [number, number] = [Math.min(s, start), Math.max(e, end)];
    if (merged[0] === s && merged[1] === e && use.length === log.use.length) return log;
    use[i] = merged;
  } else {
    use.push([start, end]);
    use.sort((a, b) => a[0] - b[0]);
  }
  return { ...log, use: use.slice(-600) };
}

/** Records "I'm up" on the wake alarm. */
export function logUp(log: WakeLog, t: number): WakeLog {
  if (log.ups.includes(t)) return log;
  return { ...log, ups: [...log.ups.filter((x) => x >= t - WAKE_LOG_DAYS * DAY), t].sort((a, b) => a - b).slice(-200) };
}

/** Saves (or with `undefined`, clears) your correction for a night. */
export function withFix(log: WakeLog, id: string, fix: NightFix | undefined): WakeLog {
  const fixes = { ...log.fixes };
  if (fix) fixes[id] = fix;
  else delete fixes[id];
  return { ...log, fixes };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export type SignalKind = 'app' | 'alarm' | 'checkin' | 'journal' | 'caffeine';

export interface WakeSignal {
  kind: SignalKind;
  time: number;
  /** Same as `time` except for app use. */
  end: number;
}

const STRONG: ReadonlySet<SignalKind> = new Set<SignalKind>(['app', 'alarm', 'checkin', 'journal']);

/** Every timestamp that shows you were awake, oldest first. */
export function collectSignals(data: Pick<SleepDataset, 'checkins' | 'caffeine' | 'dayLogs' | 'wakeLog'>): WakeSignal[] {
  const out: WakeSignal[] = [];
  for (const [s, e] of data.wakeLog?.use ?? []) out.push({ kind: 'app', time: s, end: Math.max(s, e) });
  for (const t of data.wakeLog?.ups ?? []) out.push({ kind: 'alarm', time: t, end: t });
  for (const c of data.checkins ?? []) out.push({ kind: 'checkin', time: c.time, end: c.time });
  for (const l of Object.values(data.dayLogs ?? {})) {
    if (l.sleepinessAt !== undefined) out.push({ kind: 'journal', time: l.sleepinessAt, end: l.sleepinessAt });
  }
  for (const d of data.caffeine ?? []) out.push({ kind: 'caffeine', time: d.time, end: d.time });
  return out.sort((a, b) => a.time - b.time);
}

/** Signals overlapping [a, b] (app use can start before `a`). */
function signalsIn(sorted: WakeSignal[], a: number, b: number): WakeSignal[] {
  let lo = 0;
  let hi = sorted.length;
  const from = a - 12 * HOUR;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].time < from) lo = mid + 1;
    else hi = mid;
  }
  const out: WakeSignal[] = [];
  for (let i = lo; i < sorted.length && sorted[i].time <= b; i++) if (sorted[i].end >= a) out.push(sorted[i]);
  return out;
}

interface Bin {
  t: number;
  v: number;
}

const BIN_MS = 10 * MINUTE;

/** A stored curve as absolute 10-minute bins; merged sessions ("a+b") combine their parts. */
function curveBins(m: SessionMetrics, vitals: Record<string, NightVitals>, starts: Map<string, number>, key: 'stepCurve' | 'hrCurve'): Bin[] {
  const parts = m.id.includes('+') ? m.id.split('+') : [m.id];
  const out: Bin[] = [];
  for (const id of parts) {
    const curve = vitals[id]?.[key];
    const s0 = starts.get(id) ?? (parts.length === 1 ? m.session.start : undefined);
    if (!curve || s0 === undefined) continue;
    for (const [off, v] of curve) out.push({ t: s0 + off * MINUTE, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

const stepsIn = (bins: Bin[], a: number, b: number) => bins.reduce((s, x) => (x.t >= a && x.t < b ? s + x.v : s), 0);
/** Steps in bins overlapping [a, b]. */
const stepsOverlapping = (bins: Bin[], a: number, b: number) => bins.reduce((s, x) => (x.t < b && x.t + BIN_MS > a ? s + x.v : s), 0);

const isDeepRem = (s: Stage) => s === 'deep' || s === 'rem';
const isSleep = (s: Stage) => s === 'light' || s === 'deep' || s === 'rem' || s === 'asleep';

function stageMin(segs: StageSegment[], a: number, b: number, test: (s: Stage) => boolean): number {
  let ms = 0;
  for (const s of segs) if (test(s.stage)) ms += Math.max(0, Math.min(b, s.end) - Math.max(a, s.start));
  return ms / MINUTE;
}

/** Paints [a, b) with `stage` (only over segments that pass `only`, when given). */
function paint(segs: StageSegment[], a: number, b: number, stage: Stage, only?: (s: Stage) => boolean): StageSegment[] {
  if (b <= a) return segs;
  const out: StageSegment[] = [];
  for (const s of segs) {
    if (s.end <= a || s.start >= b || (only && !only(s.stage))) {
      out.push(s);
      continue;
    }
    if (s.start < a) out.push({ ...s, end: a });
    out.push({ stage, start: Math.max(a, s.start), end: Math.min(b, s.end) });
    if (s.end > b) out.push({ ...s, start: b });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low';
/** Where a boundary came from: the recording, the watch's stages, you, or a kind of evidence. */
export type BoundarySource = 'recorded' | 'watch' | 'you' | 'steps' | SignalKind;

export interface Boundary {
  time: number;
  source: BoundarySource;
  confidence: Confidence;
}

export interface WakeEpisode {
  start: number;
  end: number;
  minutes: number;
  /** Got out of bed (≥ 20 steps) or used eepy, rather than lying awake. */
  up: boolean;
  steps: number;
  usedEepy: boolean;
}

export interface NightTimeline {
  id: string;
  /** What the watch / phone recorded. */
  recorded: { start: number; end: number; onset: number; finalWake: number };
  inBed: Boundary;
  asleep: Boundary;
  woke: Boundary;
  outOfBed: Boundary;
  /** Minutes cut from the end of the recording (you were up). */
  trimmedMin: number;
  /** Minutes sleep onset moved (later = you were still awake). */
  onsetShiftMin: number;
  /** Why onset moved / what eepy saw around it: "used eepy until 11:40 PM" style labels. */
  onsetEvidence: string[];
  /** Evidence around getting up, e.g. ["opened eepy", "230 steps"]. */
  upEvidence: string[];
  /** Last time eepy was on screen before you fell asleep. */
  lastUseBeforeSleep?: number;
  episodes: WakeEpisode[];
  /** Your correction applied (any time set). */
  fixed: boolean;
  /** You said "Looks right". */
  confirmed: boolean;
  /** Nothing detected, but the wake-up is far later than usual: worth asking. */
  askLate: boolean;
  /** Usual wake-up for this kind of day (minutes after midnight), when known. */
  usualWakeMin?: number;
}

const EVIDENCE_LABEL: Record<SignalKind, string> = {
  app: 'opened eepy',
  alarm: 'stopped the alarm',
  checkin: 'checked in',
  journal: 'rated your sleepiness',
  caffeine: 'logged a drink',
};

/** Why onset moved: "you were still up until 11:40 PM (using eepy)". */
const ONSET_LABEL: Record<SignalKind | 'steps', string> = {
  app: 'using eepy',
  alarm: 'alarm',
  checkin: 'checked in',
  journal: 'rated your sleepiness',
  caffeine: 'logged a drink',
  steps: 'walking around',
};

// ---------------------------------------------------------------------------
// One night
// ---------------------------------------------------------------------------

interface NightInput {
  signals: WakeSignal[];
  steps: Bin[];
  hr: Bin[];
  fix?: NightFix;
  detect: boolean;
}

interface Candidate {
  at: number;
  kind: SignalKind | 'steps';
}

/** Corrects one main sleep. Returns the input metrics object itself when nothing changed. */
export function correctNight(m: SessionMetrics, input: NightInput): { metrics: SessionMetrics; timeline: NightTimeline } {
  const R = WAKE_RULES;
  const segs = m.segments;
  const rec = { start: m.start, end: m.end, onset: m.sleepOnset, finalWake: m.finalWake };
  const staged = m.hasStages;
  const deepRem = segs.filter((s) => isDeepRem(s.stage));
  const firstDeep = deepRem[0]?.start;
  const lastDeepEnd = deepRem.length ? deepRem[deepRem.length - 1].end : undefined;
  const { fix, detect, steps, hr } = input;
  const strong = input.signals.filter((s) => STRONG.has(s.kind));
  const asleepAfter = (t: number) => stageMin(segs, t, rec.end, isDeepRem) >= R.backToSleepMin;

  const sleepHr = hr.filter((b) => b.t >= rec.onset && b.t < rec.finalWake).map((b) => b.v);
  const nightHr = sleepHr.length >= 6 ? median(sleepHr) : undefined;
  const hrAbove = (a: number, b: number, bpm: number = R.hrRiseBpm) => {
    if (nightHr === undefined) return false;
    const xs = hr.filter((x) => x.t >= a && x.t < b).map((x) => x.v);
    return xs.length >= 2 && mean(xs) >= nightHr + bpm;
  };
  const hrRiseAt = (t: number) => hrAbove(t - 10 * MINUTE, t + 20 * MINUTE);

  // --- Got up: the earliest sign of being up that wasn't followed by real sleep (rules 1–4).
  let up: Candidate | undefined;
  if (detect) {
    const from = rec.onset + R.minSleepBeforeWakeMin * MINUTE;
    const to = rec.end - R.minChangeMin * MINUTE;
    const cands: Candidate[] = [];
    for (const s of strong) {
      if (s.time < from || s.time > to || asleepAfter(s.time)) continue;
      if (!staged) {
        const w = s.time + R.corroborateMin * MINUTE;
        const other = strong.some((o) => o !== s && o.time > s.time && o.time <= w);
        if (!other && stepsIn(steps, s.time - BIN_MS, w) < R.upSteps && !hrRiseAt(s.time)) continue;
      }
      cands.push({ at: s.time, kind: s.kind });
    }
    for (const b of steps) {
      if (b.t < from || b.t > to || b.v < R.upSteps) continue;
      if (stepsIn(steps, b.t, b.t + R.burstWindowMin * MINUTE) < R.burstSteps || asleepAfter(b.t)) continue;
      cands.push({ at: b.t, kind: 'steps' });
      break;
    }
    up = cands.sort((a, b) => a.at - b.at)[0];
  }
  let detectedEnd: number | undefined;
  if (up) {
    const end = Math.max(up.at, lastDeepEnd ?? -Infinity);
    if (rec.end - end >= R.minChangeMin * MINUTE) detectedEnd = end;
  }

  // --- Falling asleep (rules 7–8).
  const ceiling = Math.min(
    staged && firstDeep !== undefined ? firstDeep : Infinity,
    rec.onset + (staged ? R.onsetWindowMin : R.onsetWindowUnstagedMin) * MINUTE,
    (detectedEnd ?? rec.end) - 30 * MINUTE,
  );
  let awakeUntil: Candidate | undefined;
  if (detect) {
    for (const s of strong) {
      const until = s.kind === 'app' ? s.end : s.time;
      if (until <= rec.onset || s.time >= ceiling) continue;
      const at = Math.min(until, ceiling);
      if (!awakeUntil || at > awakeUntil.at) awakeUntil = { at, kind: s.kind };
    }
    for (const b of steps) {
      if (b.t <= rec.onset || b.t >= ceiling || b.v < R.upSteps) continue;
      if (!awakeUntil || b.t > awakeUntil.at) awakeUntil = { at: b.t, kind: 'steps' };
    }
  }
  const longLight = staged && firstDeep !== undefined && firstDeep - rec.onset >= R.longLightMin * MINUTE;
  const hrNotDropped = hrAbove(rec.onset, rec.onset + 30 * MINUTE, R.hrAwakeBpm);

  let onset = rec.onset;
  let onsetSource: BoundarySource = staged ? 'watch' : 'recorded';
  let onsetConf: Confidence = longLight || hrNotDropped ? 'low' : staged ? 'medium' : 'low';
  const onsetEvidence: string[] = [];
  if (fix?.asleep !== undefined) {
    onset = Math.min(Math.max(fix.asleep, rec.start), (fix.wake ?? detectedEnd ?? rec.end) - 30 * MINUTE);
    onsetSource = 'you';
    onsetConf = 'high';
  } else if (awakeUntil && awakeUntil.at - rec.onset >= R.minChangeMin * MINUTE) {
    onset = awakeUntil.at;
    onsetSource = awakeUntil.kind;
    onsetConf = longLight || hrNotDropped ? 'high' : 'medium';
    onsetEvidence.push(ONSET_LABEL[awakeUntil.kind]);
  }
  if (longLight) onsetEvidence.push('long light sleep before deep sleep');
  if (hrNotDropped) onsetEvidence.push("heart rate hadn't dropped yet");

  // --- Woke up / got up, with your correction first (rule 10).
  const firstUpAfter = (t: number): Candidate | undefined => {
    if (!detect) return undefined;
    const s = strong.find((x) => x.time >= t && x.time <= rec.end);
    const b = steps.find((x) => x.t >= t && x.t <= rec.end && x.v >= R.upSteps);
    if (s && (!b || s.time <= b.t)) return { at: s.time, kind: s.kind };
    return b ? { at: b.t, kind: 'steps' } : undefined;
  };
  const clamp = (t: number, a: number, b: number) => Math.min(b, Math.max(a, t));
  let wake: number | undefined;
  let end = rec.end;
  let outSource: BoundarySource = 'recorded';
  if (fix?.wake !== undefined) wake = clamp(fix.wake, onset + 30 * MINUTE, rec.end);
  if (fix?.up !== undefined) {
    end = clamp(fix.up, wake ?? onset + 30 * MINUTE, rec.end);
    outSource = 'you';
  } else if (wake !== undefined) {
    const after = firstUpAfter(wake);
    end = after ? after.at : wake;
    outSource = after ? after.kind : 'you';
  } else if (detectedEnd !== undefined && up) {
    end = detectedEnd;
    outSource = up.kind;
  }
  if (wake !== undefined && wake > end) wake = end;

  // --- New stages: awake before onset and after the wake-up you gave; your times can also turn
  // recorded wakefulness into sleep; eepy use in the middle of the night is time awake (rule 9).
  let out = segs
    .map((s) => ({ stage: s.stage, start: Math.max(s.start, rec.start), end: Math.min(s.end, end) }))
    .filter((s) => s.end > s.start);
  out = paint(out, rec.start, onset, 'awake');
  if (onset < rec.onset) out = paint(out, onset, rec.onset, 'asleep', (s) => s === 'awake');
  if (wake !== undefined) {
    if (wake > rec.finalWake) out = paint(out, rec.finalWake, wake, 'asleep', (s) => s === 'awake');
    out = paint(out, wake, end, 'awake');
  }
  const marks: WakeSignal[] = [];
  if (detect) {
    for (const s of strong) {
      if (s.time <= onset || s.time >= end) continue;
      const markEnd = s.kind === 'app' ? Math.min(Math.max(s.end, s.time + R.useMinMin * MINUTE), s.time + R.useMaxMin * MINUTE) : s.time + R.useMinMin * MINUTE;
      // Only in the middle of the night: some sleep must follow.
      if (stageMin(out, markEnd, end, isSleep) < R.backToSleepMin) continue;
      out = paint(out, s.time, Math.min(markEnd, end), 'awake');
      marks.push(s);
    }
  }

  const changed = end !== rec.end || onset !== rec.onset || wake !== undefined || marks.length > 0;
  let metrics = m;
  if (changed) {
    const session: SleepSession = { ...m.session, start: rec.start, end, stages: out };
    const next = computeSessionMetrics(session);
    if (next) {
      next.isNap = false;
      metrics = next;
    }
  }

  // --- Boundaries and confidence.
  const nearUp = (t: number) => {
    const sig = input.signals.filter((s) => s.time >= t - 10 * MINUTE && s.time <= t + 30 * MINUTE);
    const kinds = new Set<string>(sig.map((s) => s.kind));
    const n = stepsIn(steps, t - 10 * MINUTE, t + 30 * MINUTE);
    const labels = [...new Set(sig.map((s) => EVIDENCE_LABEL[s.kind]))];
    if (n >= R.upSteps) {
      kinds.add('steps');
      labels.push(`${Math.round(n)} steps`);
    }
    if (hrRiseAt(t)) {
      kinds.add('heart');
      labels.push('heart rate up');
    }
    return { kinds, labels };
  };
  const finalWake = metrics.finalWake;
  let upEvidence: string[] = [];
  let outConf: Confidence;
  if (outSource === 'you') outConf = 'high';
  else if (outSource !== 'recorded') {
    const near = nearUp(end);
    upEvidence = near.labels;
    outConf = near.kinds.size >= 2 ? 'high' : 'medium';
  } else {
    // Nothing cut: does anything confirm you got up when the recording ended?
    const near = nearUp(rec.end);
    const awakeTail = (rec.end - rec.finalWake) / MINUTE;
    if (near.labels.length && (near.kinds.size > 1 || !near.kinds.has('caffeine'))) {
      upEvidence = near.labels;
      outConf = 'high';
    } else outConf = awakeTail >= 45 ? 'low' : 'medium';
  }

  let wokeSource: BoundarySource;
  let wokeConf: Confidence;
  if (wake !== undefined) {
    wokeSource = 'you';
    wokeConf = 'high';
  } else if (finalWake < end - MINUTE) {
    // The watch saw you awake before you got up.
    wokeSource = staged ? 'watch' : 'recorded';
    wokeConf = staged ? (outSource === 'recorded' ? 'medium' : 'high') : 'medium';
  } else {
    wokeSource = outSource === 'recorded' ? (staged ? 'watch' : 'recorded') : outSource;
    wokeConf = outSource === 'recorded' ? (upEvidence.length ? 'high' : 'medium') : 'medium';
  }

  const ok = !!fix?.ok;
  const lift = (c: Confidence): Confidence => (ok ? 'high' : c);
  const lastUse = input.signals
    .filter((s) => s.kind === 'app' && s.end >= rec.start - 3 * HOUR && s.time <= metrics.sleepOnset)
    .reduce<number | undefined>((t, s) => Math.max(t ?? -Infinity, Math.min(s.end, metrics.sleepOnset)), undefined);

  const timeline: NightTimeline = {
    id: m.id,
    recorded: rec,
    inBed: { time: rec.start, source: staged ? 'watch' : 'recorded', confidence: rec.start === rec.onset && onset === rec.onset ? 'low' : 'medium' },
    asleep: { time: metrics.sleepOnset, source: onsetSource, confidence: lift(onsetConf) },
    woke: { time: finalWake, source: wokeSource, confidence: lift(wokeConf) },
    outOfBed: { time: metrics.end, source: outSource, confidence: lift(outConf) },
    trimmedMin: Math.round((rec.end - metrics.end) / MINUTE),
    onsetShiftMin: Math.round((metrics.sleepOnset - rec.onset) / MINUTE),
    onsetEvidence,
    upEvidence,
    lastUseBeforeSleep: lastUse,
    episodes: wakeEpisodes(metrics, steps, input.signals),
    fixed: fix?.wake !== undefined || fix?.asleep !== undefined || fix?.up !== undefined,
    confirmed: ok,
    askLate: false,
  };
  return { metrics, timeline };
}

/** Wake-ups between sleep onset and the final wake (rule 9). */
export function wakeEpisodes(m: SessionMetrics, steps: { t: number; v: number }[] = [], signals: WakeSignal[] = []): WakeEpisode[] {
  const runs: { start: number; end: number }[] = [];
  for (const s of m.segments) {
    if (isSleep(s.stage) || s.end <= m.sleepOnset || s.start >= m.finalWake) continue;
    const last = runs[runs.length - 1];
    if (last && s.start - last.end < WAKE_RULES.episodeMergeMin * MINUTE) last.end = s.end;
    else runs.push({ start: s.start, end: s.end });
  }
  const out: WakeEpisode[] = [];
  for (const r of runs) {
    const n = Math.round(stepsOverlapping(steps, r.start, r.end));
    const usedEepy = signals.some((s) => STRONG.has(s.kind) && s.time < r.end && s.end >= r.start);
    const minutes = Math.round((r.end - r.start) / MINUTE);
    const up = n >= WAKE_RULES.upSteps || usedEepy;
    if (minutes >= WAKE_RULES.episodeMin || up) out.push({ start: r.start, end: r.end, minutes, up, steps: n, usedEepy });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Every night
// ---------------------------------------------------------------------------

export interface CorrectedNights {
  metrics: SessionMetrics[];
  /** By main-sleep id. */
  timelines: Record<string, NightTimeline>;
}

/**
 * analyzeSessions + the corrections above: the sessions every model should use. Naps and manual logs
 * pass through untouched.
 */
export function correctedMetrics(data: SleepDataset, sessions: SleepSession[], opts: SessionAnalyzeOptions = {}): CorrectedNights {
  const raw = analyzeSessions(sessions, opts);
  const log = data.wakeLog;
  const detect = log?.detect !== false;
  const fixes = log?.fixes ?? {};
  const signals = collectSignals(data);
  const starts = new Map(sessions.map((s) => [s.id, s.start]));
  const timelines: Record<string, NightTimeline> = {};
  const metrics = raw.map((m) => {
    if (m.isNap || m.session.source === 'manual') return m;
    const r = correctNight(m, {
      signals: signalsIn(signals, m.start - 3 * HOUR, m.end + HOUR),
      steps: curveBins(m, data.vitals, starts, 'stepCurve'),
      hr: curveBins(m, data.vitals, starts, 'hrCurve'),
      fix: fixes[m.id],
      detect,
    });
    timelines[m.id] = r.timeline;
    return r.metrics;
  });
  markLateWakes(metrics, timelines, data.profile);
  return { metrics, timelines };
}

/** Rule 11: nothing detected, but you "slept" ≥ 90 min past your usual wake-up for that kind of day. */
function markLateWakes(metrics: SessionMetrics[], timelines: Record<string, NightTimeline>, profile: Profile) {
  const workday = (m: SessionMetrics) => profile.workdays.includes(weekdayOfKey(m.wakeDate));
  const mains = metrics.filter((m) => timelines[m.id]);
  for (let i = 0; i < mains.length; i++) {
    const m = mains[i];
    const t = timelines[m.id];
    const prior = mains
      .slice(Math.max(0, i - 40), i)
      .filter((x) => x.finalWake > m.finalWake - 28 * DAY && x.finalWake < m.finalWake - 12 * HOUR && workday(x) === workday(m));
    if (prior.length < 3) continue;
    const usual = circularMeanMinutes(prior.map((x) => minutesOfDay(x.finalWake)));
    if (usual === undefined) continue;
    t.usualWakeMin = Math.round(usual);
    t.askLate = t.trimmedMin === 0 && !t.fixed && !t.confirmed && clockDiff(usual, minutesOfDay(m.finalWake)) >= WAKE_RULES.askLateMin;
  }
}
