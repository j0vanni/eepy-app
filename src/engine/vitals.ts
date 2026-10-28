import { mean, median, sd } from './stats';
import { addDays, clamp, MINUTE } from './time';
import type { DailyStats, NightVitals, VitalSample } from './types';
import type { Night } from './sessions';

interface SessionWindow {
  id: string;
  start: number;
  end: number;
  sleepOnset: number;
  finalWake: number;
}

const within = (xs: VitalSample[], a: number, b: number) => xs.filter((x) => x.time >= a && x.time <= b);

/**
 * Condenses raw watch samples into a per-night summary. Only the summary is stored, which keeps the
 * on-device database small even with minute-level heart-rate data.
 */
export function summarizeNightVitals(
  s: SessionWindow,
  data: { hr?: VitalSample[]; hrv?: VitalSample[]; spo2?: VitalSample[]; resp?: VitalSample[] },
): NightVitals {
  const out: NightVitals = { sessionId: s.id };

  const hr = within(data.hr ?? [], s.sleepOnset, s.finalWake).sort((a, b) => a.time - b.time);
  if (hr.length >= 3) {
    // Smooth with a 5-sample moving average so a single artefact can't define the minimum.
    const k = Math.min(5, hr.length);
    let best = Infinity;
    let bestT = hr[0].time;
    for (let i = 0; i + k <= hr.length; i++) {
      const m = mean(hr.slice(i, i + k).map((x) => x.value));
      if (m < best) {
        best = m;
        bestT = hr[i + Math.floor(k / 2)].time;
      }
    }
    out.hrMin = Math.round(best);
    out.hrAvg = Math.round(mean(hr.map((x) => x.value)));
    out.hrNadirOffsetMin = Math.round((bestT - s.sleepOnset) / MINUTE);
    const curve: [number, number][] = [];
    for (let t = s.start; t < s.end; t += 10 * MINUTE) {
      const bin = hr.filter((x) => x.time >= t && x.time < t + 10 * MINUTE);
      if (bin.length) curve.push([Math.round((t - s.start) / MINUTE), Math.round(mean(bin.map((x) => x.value)))]);
    }
    out.hrCurve = curve;
  }

  const hrvIn = within(data.hrv ?? [], s.sleepOnset, s.finalWake);
  const hrvNear = hrvIn.length ? hrvIn : within(data.hrv ?? [], s.finalWake - 60 * MINUTE, s.finalWake + 120 * MINUTE);
  if (hrvNear.length) out.hrvRmssd = Math.round(mean(hrvNear.map((x) => x.value)));

  const spo2 = within(data.spo2 ?? [], s.sleepOnset, s.finalWake)
    .filter((x) => x.value >= 70 && x.value <= 100)
    .sort((a, b) => a.time - b.time);
  if (spo2.length) {
    out.spo2Avg = Math.round(mean(spo2.map((x) => x.value)) * 10) / 10;
    out.spo2Min = Math.min(...spo2.map((x) => x.value));
    out.spo2Samples = spo2.length;
    const hours = (s.finalWake - s.sleepOnset) / (60 * MINUTE);
    // Desaturation index only when sampling is dense (≥ 1 reading per ~5 min).
    if (hours > 0 && spo2.length / (hours * 12) >= 0.6) {
      let dips = 0;
      let inDip = false;
      for (let i = 10; i < spo2.length; i++) {
        const base = median(spo2.slice(i - 10, i).map((x) => x.value));
        const drop = base - spo2[i].value;
        if (drop >= 3 && !inDip) {
          dips++;
          inDip = true;
        } else if (drop < 1.5) inDip = false;
      }
      out.spo2DipsPerHour = Math.round((dips / hours) * 10) / 10;
    }
  }

  const resp = within(data.resp ?? [], s.sleepOnset, s.finalWake);
  if (resp.length) out.respRate = Math.round(mean(resp.map((x) => x.value)) * 10) / 10;
  return out;
}

export interface Baseline {
  mean: number;
  sd: number;
  n: number;
}

export function baseline(values: number[]): Baseline | undefined {
  if (values.length < 5) return undefined;
  return { mean: mean(values), sd: Math.max(sd(values), 1e-6), n: values.length };
}

export interface ReadinessContributor {
  key: 'sleep' | 'debt' | 'hrv' | 'rhr' | 'regularity';
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface Readiness {
  score: number;
  label: 'Primed' | 'Good' | 'Fair' | 'Take it easy';
  contributors: ReadinessContributor[];
  hrvBaseline?: Baseline;
  rhrBaseline?: Baseline;
  lastHrv?: number;
  lastRhr?: number;
}

/**
 * Morning readiness: last night's sleep, accumulated debt and how today's HRV / resting heart rate
 * compare with the personal 30-day baseline (HRV uses ln(RMSSD), the standard for day-to-day comparison).
 */
export function computeReadiness(input: {
  nights: Night[];
  vitals: Record<string, NightVitals>;
  daily: Record<string, DailyStats>;
  asOfDate: string;
  lastSleepScore?: number;
  debtMin: number;
  regularityScore?: number;
}): Readiness | undefined {
  const { nights, vitals, daily, asOfDate } = input;
  const contributors: ReadinessContributor[] = [];
  if (input.lastSleepScore !== undefined) {
    contributors.push({ key: 'sleep', label: 'Last night', score: input.lastSleepScore, weight: 35, detail: `Sleep score ${input.lastSleepScore}.` });
  }
  contributors.push({
    key: 'debt',
    label: 'Sleep debt',
    score: Math.round(clamp(100 - (input.debtMin / 60) * 8, 0, 100)),
    weight: 20,
    detail: input.debtMin < 30 ? 'No meaningful debt.' : `${Math.round(input.debtMin / 6) / 10}h of debt is weighing on you.`,
  });

  const from = addDays(asOfDate, -30);
  const hist = nights.filter((n) => n.main && n.wakeDate >= from && n.wakeDate < asOfDate);
  // Compare like with like: use whichever series (overnight summary vs. daily record) has more history.
  const count = (f: (n: Night) => number | undefined) => hist.filter((n) => f(n) !== undefined).length;
  const nightHrv = (n: Night) => vitals[n.main!.id]?.hrvRmssd;
  const dayHrv = (n: Night) => daily[n.wakeDate]?.hrv;
  const nightHr = (n: Night) => vitals[n.main!.id]?.hrMin;
  const dayHr = (n: Night) => daily[n.wakeDate]?.restingHr;
  const hrvOf = count(nightHrv) >= count(dayHrv) ? nightHrv : dayHrv;
  const rhrOf = count(nightHr) >= count(dayHr) ? nightHr : dayHr;
  const today = nights.find((n) => n.wakeDate === asOfDate && n.main);

  const hrvBase = baseline(hist.map(hrvOf).filter((x): x is number => !!x && x > 0).map(Math.log));
  const lastHrv = today ? hrvOf(today) : undefined;
  if (hrvBase && lastHrv) {
    const z = (Math.log(lastHrv) - hrvBase.mean) / hrvBase.sd;
    contributors.push({
      key: 'hrv',
      label: 'HRV',
      score: Math.round(clamp(72 + 14 * z, 0, 100)),
      weight: 25,
      detail:
        z <= -1
          ? `HRV ${lastHrv} ms is well below your normal (${Math.round(Math.exp(hrvBase.mean))} ms) — a sign of strain, illness or a late meal/alcohol.`
          : z >= 0.5
            ? `HRV ${lastHrv} ms is above your normal (${Math.round(Math.exp(hrvBase.mean))} ms).`
            : `HRV ${lastHrv} ms is in your normal range.`,
    });
  }

  const rhrBase = baseline(hist.map(rhrOf).filter((x): x is number => !!x && x > 0));
  const lastRhr = today ? rhrOf(today) : undefined;
  if (rhrBase && lastRhr) {
    const delta = lastRhr - rhrBase.mean;
    contributors.push({
      key: 'rhr',
      label: 'Resting HR',
      score: Math.round(clamp(82 - 7 * delta, 0, 100)),
      weight: 20,
      detail:
        delta >= 3
          ? `Resting HR ${lastRhr} bpm is ${Math.round(delta)} above your normal — recovery may be incomplete.`
          : `Resting HR ${lastRhr} bpm (normal ${Math.round(rhrBase.mean)}).`,
    });
  }
  if (input.regularityScore !== undefined) {
    contributors.push({ key: 'regularity', label: 'Consistency', score: input.regularityScore, weight: 10, detail: 'How regular your sleep timing has been.' });
  }
  if (contributors.length < 2) return undefined;
  const w = contributors.reduce((s, c) => s + c.weight, 0);
  const score = Math.round(contributors.reduce((s, c) => s + c.weight * c.score, 0) / w);
  return {
    score,
    label: score >= 85 ? 'Primed' : score >= 70 ? 'Good' : score >= 55 ? 'Fair' : 'Take it easy',
    contributors,
    hrvBaseline: hrvBase,
    rhrBaseline: rhrBase,
    lastHrv,
    lastRhr,
  };
}
