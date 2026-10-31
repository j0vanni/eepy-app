/**
 * Synthetic but physiologically plausible data for demo mode and tests: ~9 weeks of nights with
 * staged sleep cycles, heart rate / HRV / SpO2, journal tags whose effects are baked in (so the
 * insight engine has something real to find), naps and caffeine logs.
 */
import type { CircadianParams } from './alertness';
import { calibrationContext, createKssPredictor, livingDay } from './calibration';
import { gaussian, rng } from './stats';
import { addDays, atMinutes, clamp, dateKey, DAY, HOUR, MINUTE, weekdayOfKey } from './time';
import {
  AlertnessCheckIn,
  CaffeineDose,
  DailyStats,
  DayLog,
  DEFAULT_PROFILE,
  NightVitals,
  Profile,
  SleepDataset,
  SleepSession,
  Stage,
  StageSegment,
  VitalSample,
  Workout,
} from './types';
import { pruneSpo2Curves } from './breathing';
import { summarizeNightVitals } from './vitals';
import { computeSessionMetrics } from './sessions';

export const DEMO_ORIGIN = 'demo.cmf.watch';

/** The demo person's "true" body clock: ~50 min later than average, a pronounced post-lunch dip. */
export const DEMO_RHYTHM: CircadianParams = { phaseShiftMin: 60, ampScale: 1.15, dipScale: 2, kssOffset: 0.6 };
const DEMO_NOISE = 0.6;

interface NightFx {
  alcohol: boolean;
  lateCaffeine: boolean;
  exercise: boolean;
  lateMeal: boolean;
  screens: boolean;
  stress: boolean;
  reading: boolean;
}

function buildStages(rand: () => number, onset: number, wake: number, fx: NightFx): StageSegment[] {
  const segs: StageSegment[] = [];
  let t = onset;
  const deepPlan = [40, 30, 15, 7, 3, 0, 0];
  const remPlan = [9, 17, 24, 29, 33, 36, 36];
  for (let k = 0; t < wake && k < 8; k++) {
    const len = clamp(gaussian(rand, 92, 7), 75, 110) * MINUTE;
    let deep = (deepPlan[k] ?? 0) * (fx.exercise ? 1.15 : 1) * (fx.lateCaffeine ? 0.75 : 1) * (fx.alcohol && k < 2 ? 1.1 : 1);
    let rem = (remPlan[k] ?? 36) * (fx.alcohol ? (k < 3 ? 0.45 : 0.85) : 1) * (fx.stress ? 0.9 : 1);
    deep = Math.max(0, deep + gaussian(rand, 0, 4)) * MINUTE;
    rem = Math.max(3, rem + gaussian(rand, 0, 4)) * MINUTE;
    const light = Math.max(10 * MINUTE, len - deep - rem);
    const parts: [Stage, number][] = [
      ['light', light * 0.6],
      ['deep', deep],
      ['light', light * 0.4],
      ['rem', rem],
    ];
    for (const [stage, dur] of parts) {
      if (dur <= 0 || t >= wake) continue;
      const end = Math.min(wake, t + dur);
      segs.push({ stage, start: t, end });
      t = end;
    }
  }
  return segs;
}

/** Replaces short stretches of sleep with wakefulness. */
function overlayAwakenings(segs: StageSegment[], times: { at: number; dur: number }[]): StageSegment[] {
  let out = segs;
  for (const { at, dur } of times) {
    const next: StageSegment[] = [];
    for (const s of out) {
      if (at >= s.end || at + dur <= s.start) {
        next.push(s);
        continue;
      }
      if (s.start < at) next.push({ ...s, end: at });
      next.push({ stage: 'awake', start: Math.max(at, s.start), end: Math.min(at + dur, s.end) });
      if (s.end > at + dur) next.push({ ...s, start: at + dur });
    }
    out = next;
  }
  return out;
}

function hrSamples(rand: () => number, segs: StageSegment[], start: number, end: number, base: number, lateNadir: boolean): VitalSample[] {
  const out: VitalSample[] = [];
  const dur = end - start;
  const nadirAt = start + dur * (lateNadir ? 0.72 : 0.38);
  for (let t = start; t <= end; t += 5 * MINUTE) {
    const seg = segs.find((s) => s.start <= t && t < s.end);
    const dist = Math.abs(t - nadirAt) / dur;
    let v = base + 10 * (dist / 0.6) ** 2 + gaussian(rand, 0, 1.2);
    if (seg?.stage === 'rem') v += 4;
    if (seg?.stage === 'awake') v += 9;
    out.push({ time: t, value: Math.round(v) });
  }
  return out;
}

/**
 * Overnight SpO₂ like a wrist sensor reading every ~2 minutes: a steady ~96% baseline, slightly
 * lower in REM, noisier while awake, a few short 3–6 point dips an hour (about 12 an hour after
 * alcohol, which relaxes the airway), the odd single-reading glitch, sometimes a loose-strap gap
 * of 1–2.5 h and, on ~5% of nights, only one reading every 15 minutes.
 */
function demoSpo2(rand: () => number, segs: StageSegment[], onset: number, wake: number, alcohol: boolean): VitalSample[] {
  const sparse = rand() < 0.05;
  const step = (sparse ? 15 : 2) * MINUTE;
  const base = gaussian(rand, 96, 0.4);
  const gap = rand() < 0.12 ? { start: onset + (0.2 + rand() * 0.5) * (wake - onset), dur: (60 + rand() * 90) * MINUTE } : undefined;
  const perHour = alcohol ? 12 : 1.5;
  const dips: { at: number; dur: number; depth: number }[] = [];
  for (let t = onset; ; ) {
    t += (-Math.log(Math.max(rand(), 1e-9)) / perHour) * HOUR;
    if (t >= wake) break;
    dips.push({ at: t, dur: (1 + rand() * 2.5) * MINUTE, depth: 3.2 + rand() * 2.6 });
  }
  const out: VitalSample[] = [];
  for (let t = onset + rand() * step; t < wake; t += step + (rand() - 0.5) * 20_000) {
    if (gap && t >= gap.start && t < gap.start + gap.dur) continue;
    const stage = segs.find((s) => s.start <= t && t < s.end)?.stage;
    let v = base + (stage === 'rem' ? -0.5 : 0) + gaussian(rand, 0, stage === 'awake' ? 1.4 : 0.5);
    let drop = 0;
    for (const d of dips) {
      const x = (t - d.at) / d.dur;
      if (x >= 0 && x <= 1) drop = Math.max(drop, d.depth * Math.min(1, 2.5 * (1 - Math.abs(2 * x - 1))));
    }
    v -= drop;
    if (rand() < 0.002) v = 78 + rand() * 7; // sensor glitch
    out.push({ time: Math.round(t), value: Math.round(clamp(v, 70, 100)), origin: DEMO_ORIGIN });
  }
  return out;
}

export function generateDemoData(now: number, opts: { days?: number; seed?: number } = {}): SleepDataset {
  const days = opts.days ?? 63;
  const rand = rng(opts.seed ?? 42);
  const today = dateKey(now);
  const trueNeed = 485;
  const profile: Profile = {
    ...DEFAULT_PROFILE,
    name: 'Demo',
    birthYear: Number(today.slice(0, 4)) - 27,
    workWakeMin: 7 * 60,
    onboarded: true,
  };

  const sessions: SleepSession[] = [];
  const vitals: Record<string, NightVitals> = {};
  const daily: Record<string, DailyStats> = {};
  const dayLogs: Record<string, DayLog> = {};
  const caffeine: CaffeineDose[] = [];
  const workouts: Workout[] = [];
  /** eepy on screen before bed / in the morning (wake-up detection evidence). */
  const appUse: [number, number][] = [];
  let debt = 0;
  const spo2Rand = rng((opts.seed ?? 42) + 104729);

  for (let i = days; i >= 0; i--) {
    const wakeDate = addDays(today, -i);
    const eve = addDays(wakeDate, -1);
    const evWd = weekdayOfKey(eve);
    const workday = profile.workdays.includes(weekdayOfKey(wakeDate));
    const weekendEve = evWd === 5 || evWd === 6;

    const fx: NightFx = {
      alcohol: rand() < (weekendEve ? 0.4 : 0.1),
      lateCaffeine: rand() < 0.13,
      exercise: rand() < 0.45,
      lateMeal: rand() < 0.15,
      screens: rand() < 0.3,
      stress: !weekendEve && rand() < 0.22,
      reading: rand() < 0.25,
    };

    // Evening caffeine + daytime logs for the evening's day.
    const evWake = atMinutes(eve, workday || !weekendEve ? 7 * 60 : 8.5 * 60);
    if (rand() < 0.9) caffeine.push({ id: `c-${eve}-1`, time: evWake + 50 * MINUTE, mg: 95, label: 'Coffee (8 oz / 240 ml)' });
    if (rand() < 0.3) caffeine.push({ id: `c-${eve}-2`, time: atMinutes(eve, 13 * 60 + rand() * 150), mg: 63, label: 'Espresso shot' });
    if (fx.lateCaffeine) caffeine.push({ id: `c-${eve}-3`, time: atMinutes(eve, 17 * 60 + rand() * 90), mg: 120, label: 'Cold brew (16 oz)' });

    // Sleep timing.
    let onsetMin = weekendEve ? gaussian(rand, 24 * 60 + 40, 35) : gaussian(rand, 23 * 60 + 35, 28);
    if (i === 0) onsetMin = 24 * 60 + 55; // last night: a late one, so the nap logic has something to do
    // Every other exercise day is a late workout (no extra rand() calls, so the rest of the demo is unchanged).
    const lateWorkout = fx.exercise && i % 2 === 0;
    const latency = Math.max(3, gaussian(rand, 12, 4) + (fx.lateCaffeine ? 14 : 0) + (fx.screens ? 8 : 0) + (fx.stress ? 10 : 0) - (fx.exercise ? 3 : 0) + (lateWorkout ? 9 : 0));
    if (fx.exercise) {
      const ws = atMinutes(eve, lateWorkout ? 21 * 60 : 18 * 60);
      workouts.push({ id: `demo-w-${eve}`, start: ws, end: ws + (lateWorkout ? 60 : 50) * MINUTE, type: lateWorkout ? 56 : 70, origin: DEMO_ORIGIN });
    }
    const onset = atMinutes(eve, onsetMin);
    let wake: number;
    if (workday) {
      wake = atMinutes(wakeDate, 7 * 60 + gaussian(rand, 0, 5));
    } else {
      const recovery = Math.min(100, debt * 0.25);
      wake = onset + (trueNeed + recovery + gaussian(rand, 30, 20)) * MINUTE;
    }
    if (wake > now) continue;

    let stages = buildStages(rand, onset, wake, fx);
    const nWake = 1 + (rand() < 0.5 ? 1 : 0) + (fx.alcohol ? 2 : 0) + (fx.lateMeal ? 1 : 0) + (fx.stress ? 1 : 0);
    const awakenings = Array.from({ length: nWake }, () => {
      const span = wake - onset;
      const frac = fx.alcohol ? 0.5 + rand() * 0.45 : 0.15 + rand() * 0.8;
      return { at: onset + span * frac, dur: (2 + rand() * 7) * MINUTE };
    });
    stages = overlayAwakenings(stages, awakenings);
    const start = onset - latency * MINUTE;
    const end = wake + 2 * MINUTE;
    stages = [{ stage: 'awake', start, end: onset }, ...stages, { stage: 'awake', start: wake, end }];
    const session: SleepSession = { id: `demo-${wakeDate}`, source: 'demo', origin: DEMO_ORIGIN, device: 'CMF Watch 3 Pro', start, end, stages };
    sessions.push(session);

    const m = computeSessionMetrics(session)!;
    debt = Math.max(0, debt * 0.9 + (trueNeed - m.totalSleepMin));

    const hrBase = 53 + (fx.alcohol ? 6 : 0) + (fx.lateMeal ? 3 : 0) + (fx.stress ? 2 : 0) - (fx.exercise ? 1 : 0) + gaussian(rand, 0, 1.2);
    const hr = hrSamples(rand, stages, start, end, hrBase, fx.alcohol || fx.lateMeal);
    const hrv: VitalSample[] = [
      { time: wake - 30 * MINUTE, value: Math.max(18, gaussian(rand, 52, 5) - (fx.alcohol ? 13 : 0) - (fx.stress ? 6 : 0) + (fx.exercise ? 3 : 0)) },
    ];
    // SpO₂ comes from its own random stream; these draws keep the main stream (and so every other
    // demo value) exactly as it was before the breathing check existed.
    for (let t = onset; t < wake; t += 10 * MINUTE) gaussian(rand, 96.2, 0.9);
    const spo2 = demoSpo2(spo2Rand, stages, onset, wake, fx.alcohol);
    const resp: VitalSample[] = [{ time: onset + 2 * 3600_000, value: Math.round(gaussian(rand, 14, 0.6) * 10) / 10 }];
    vitals[session.id] = summarizeNightVitals(m, { hr, hrv, spo2, resp });
    // Steps around the night and eepy before bed, without rand() calls so every other value is unchanged:
    // a bathroom trip during a later awakening on some nights, then up and about after the recording.
    const bin = (t: number, up: boolean) => (up ? Math.ceil : Math.floor)((t - start) / (10 * MINUTE)) * 10;
    const trip = awakenings.find((a) => a.at > onset + 3 * HOUR && a.dur >= 5 * MINUTE && a.at + a.dur < wake);
    const stepCurve: [number, number][] = trip && i % 2 === 1 ? [[bin(trip.at, false), 30 + (i % 5) * 6]] : [];
    stepCurve.push([bin(end, true), 90 + (i % 4) * 25], [bin(end, true) + 10, 140]);
    vitals[session.id].stepCurve = stepCurve;
    appUse.push([start - 9 * MINUTE, start - 3 * MINUTE]);

    daily[eve] = {
      date: eve,
      steps: Math.round(Math.max(1500, fx.exercise ? gaussian(rand, 11500, 2000) : gaussian(rand, 6200, 1800))),
      restingHr: Math.round(gaussian(rand, 58, 1.8)),
    };

    // Journal for the evening's day (tags) and the wake day's morning (rating/energy).
    if (rand() < 0.88) {
      const tags = [
        fx.alcohol && 'alcohol',
        fx.lateCaffeine && 'late-caffeine',
        fx.exercise && 'exercise',
        fx.lateMeal && 'late-meal',
        fx.screens && 'screens',
        fx.stress && 'stress',
        fx.reading && 'reading',
      ].filter((x): x is string => !!x);
      dayLogs[eve] = { ...(dayLogs[eve] ?? { date: eve, tags: [] }), date: eve, tags };
    }
    if (rand() < 0.85) {
      const tst = m.totalSleepMin;
      const energy = Math.round(clamp(1.3 + 3.6 / (1 + Math.exp(-(Math.min(tst, trueNeed) - 420) / 25)) + gaussian(rand, 0, 0.45), 1, 5));
      dayLogs[wakeDate] = {
        ...(dayLogs[wakeDate] ?? { date: wakeDate, tags: [] }),
        date: wakeDate,
        energy,
        sleepRating: Math.round(clamp(energy + gaussian(rand, 0, 0.6), 1, 5)),
        wokeNaturally: !workday,
      };
    }

    // Occasional early-afternoon power nap after a short night.
    if (workday && m.totalSleepMin < 420 && rand() < 0.35 && i > 0) {
      const napStart = atMinutes(wakeDate, 14 * 60 + 20 + rand() * 30);
      sessions.push({
        id: `demo-nap-${wakeDate}`,
        source: 'demo',
        origin: DEMO_ORIGIN,
        device: 'CMF Watch 3 Pro',
        start: napStart,
        end: napStart + 24 * MINUTE,
        stages: [
          { stage: 'awake', start: napStart, end: napStart + 6 * MINUTE },
          { stage: 'light', start: napStart + 6 * MINUTE, end: napStart + 24 * MINUTE },
        ],
      });
    }
  }

  // Today so far.
  daily[today] = { date: today, steps: 3200, restingHr: 59 };
  const morningCoffee = atMinutes(today, 7 * 60 + 45);
  if (morningCoffee < now) caffeine.push({ id: `c-${today}-1`, time: morningCoffee, mg: 95, label: 'Coffee (8 oz / 240 ml)' });

  const dataset: SleepDataset = { sessions, vitals: pruneSpo2Curves(vitals, sessions), daily, dayLogs, caffeine, profile, workouts };
  // Separate random stream so adding check-ins leaves every other demo value unchanged.
  dataset.checkins = demoCheckins(dataset, now, rng((opts.seed ?? 42) + 7919));
  dataset.wakeLog = { detect: true, use: appUse, ups: [], fixes: {} };
  watchRanOn(dataset, `demo-${today}`, now);
  return dataset;
}

/**
 * Last night the watch kept "sleeping" for 80 min after you got up; you opened eepy and walked around,
 * so the wake-up detection cuts it back to exactly the night the rest of the demo was built on.
 */
function watchRanOn(data: SleepDataset, id: string, now: number) {
  const s = data.sessions.find((x) => x.id === id);
  const v = data.vitals[id];
  const RUN_ON = 80 * MINUTE;
  if (!s || !v || now < s.end + RUN_ON + 5 * MINUTE) return;
  const up = s.end;
  s.stages = [...s.stages, { stage: 'light', start: up, end: up + RUN_ON }];
  s.end = up + RUN_ON;
  const b = Math.ceil((up - s.start) / (10 * MINUTE)) * 10;
  v.stepCurve = [...(v.stepCurve ?? []).filter(([o]) => s.start + o * MINUTE < up), [b, 130], [b + 10, 100]];
  data.wakeLog!.use.push([up, up + 4 * MINUTE]);
}

/**
 * 2–3 alertness ratings a day over the last three weeks, generated by the alertness model with
 * DEMO_RHYTHM plus rating noise — so the learning screen has a real fit to show. Pings use the
 * three quick buttons (KSS 3/5/7); manual check-ins use the full 1–9 scale.
 */
function demoCheckins(data: SleepDataset, now: number, rand: () => number): AlertnessCheckIn[] {
  const ctx = calibrationContext(data, now, { sleepsFrom: now - 26 * DAY });
  const predictor = createKssPredictor(ctx.sleeps, ctx.midSleepMin, (t) => ctx.debtOn(livingDay(t)));
  const today = dateKey(now);
  const out: AlertnessCheckIn[] = [];
  for (let i = 20; i >= 0; i--) {
    const date = addDays(today, -i);
    const night = data.sessions.find((s) => s.id === `demo-${date}`);
    if (!night) continue;
    const windows: [string, number, number][] = [
      ['morning', night.end + 1.25 * HOUR, Math.min(night.end + 4 * HOUR, atMinutes(date, 12 * 60))],
      ['afternoon', atMinutes(date, 13 * 60), atMinutes(date, 16 * 60)],
      ['evening', atMinutes(date, 18.5 * 60), atMinutes(date, 21.75 * 60)],
    ];
    const skip = rand() < 0.45 ? Math.floor(rand() * 3) : -1; // some days only 2
    windows.forEach(([slot, lo, hi], k) => {
      const t = Math.round((lo + rand() * (hi - lo)) / MINUTE) * MINUTE;
      const ping = rand() < 0.65;
      const noise = gaussian(rand, 0, DEMO_NOISE);
      if (k === skip || hi - lo < 30 * MINUTE || t > now - 10 * MINUTE) return;
      const kss = predictor.kssAt(t, DEMO_RHYTHM);
      if (kss === undefined) return;
      let rated = Math.round(clamp(kss + noise, 1, 9));
      if (ping) rated = rated <= 4 ? 3 : rated >= 6 ? 7 : 5;
      out.push({ id: `demo-ci-${date}-${slot}`, time: t, kss: rated, source: ping ? 'ping' : 'manual' });
    });
  }
  return out;
}
