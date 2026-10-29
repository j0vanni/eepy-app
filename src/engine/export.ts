/**
 * Pure export builders: a CSV of every night and a printable HTML sleep report (the phone turns it
 * into a PDF with expo-print). No React / native imports — the file sharing lives in src/reports/.
 */
import { Analysis, trendRows } from './analysis';
import { CbtiProgram, cbtiStatus } from './cbti';
import { CHRONOTYPE_LABELS } from './chronotype';
import { QUIZZES, Quiz, scoreQuiz } from './screening';
import { analyzeSessions, buildNights, Night } from './sessions';
import { scoreSleep, SleepScore } from './sleepScore';
import { mean } from './stats';
import { TAG_BY_ID } from './tags';
import { addDays, circularMeanMinutes, circularSdMinutes, dateKey, formatClock, formatDuration, formatTime, minutesOfDay, startOfDateKey } from './time';
import type { DayLog, NightVitals, SleepDataset } from './types';

// ---------------------------------------------------------------------------------------------
// CSV

export type CsvValue = string | number | boolean | null | undefined;

/**
 * One RFC 4180 cell. Text containing a comma, quote or line break (or edge spaces) is quoted with
 * quotes doubled; text that a spreadsheet would run as a formula (= + - @) is prefixed with '.
 */
export function csvCell(v: CsvValue): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(cells: CsvValue[]): string {
  return cells.map(csvCell).join(',');
}

/** Header plus rows, CRLF line endings, trailing newline. */
export function toCsv(header: readonly string[], rows: CsvValue[][]): string {
  return [header, ...rows].map((r) => csvRow(r as CsvValue[])).join('\r\n') + '\r\n';
}

export const NIGHT_CSV_COLUMNS = [
  'date',
  'bedtime',
  'sleep_onset',
  'wake',
  'time_in_bed_min',
  'total_sleep_min',
  'light_min',
  'deep_min',
  'rem_min',
  'awake_min',
  'latency_min',
  'waso_min',
  'awakenings',
  'efficiency_pct',
  'score',
  'hr_min_bpm',
  'hr_avg_bpm',
  'hrv_rmssd_ms',
  'spo2_avg_pct',
  'spo2_min_pct',
  'nap_min',
  'sleep_rating',
  'tags',
  'source',
] as const;

export interface NightsCsvInput {
  nights: Night[];
  scores: Record<string, SleepScore>;
  vitals: Record<string, NightVitals>;
  dayLogs: Record<string, DayLog>;
}

const round = (x: number | undefined, digits = 0): number | undefined => {
  if (x === undefined || !Number.isFinite(x)) return undefined;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/** Local "YYYY-MM-DD HH:MM". */
export function localStamp(t: number): string {
  return `${dateKey(t)} ${formatTime(t)}`;
}

/** Labels of the evening tags that belong to the night ending on `wakeDate`. */
export function nightTags(dayLogs: Record<string, DayLog>, wakeDate: string): string[] {
  return (dayLogs[addDays(wakeDate, -1)]?.tags ?? []).map((t) => TAG_BY_ID[t]?.label ?? t);
}

export function nightCsvRows(input: NightsCsvInput): CsvValue[][] {
  const { nights, scores, vitals, dayLogs } = input;
  return [...nights]
    .sort((a, b) => (a.wakeDate < b.wakeDate ? -1 : a.wakeDate > b.wakeDate ? 1 : 0))
    .map((n) => {
      const m = n.main;
      const v = m ? vitals[m.id] : undefined;
      const napMin = n.naps.reduce((s, x) => s + x.totalSleepMin, 0);
      const staged = m?.hasStages;
      return [
        n.wakeDate,
        m ? localStamp(m.start) : undefined,
        m ? localStamp(m.sleepOnset) : undefined,
        m ? localStamp(m.finalWake) : undefined,
        round(m?.timeInBedMin),
        round(m?.totalSleepMin),
        staged ? round(m!.stageMin.light) : undefined,
        staged ? round(m!.stageMin.deep) : undefined,
        staged ? round(m!.stageMin.rem) : undefined,
        round(m?.stageMin.awake),
        round(m?.latencyMin),
        round(m?.wasoMin),
        m?.awakenings,
        m ? round(m.efficiency * 100, 1) : undefined,
        m ? scores[m.id]?.total : undefined,
        round(v?.hrMin),
        round(v?.hrAvg),
        round(v?.hrvRmssd, 1),
        round(v?.spo2Avg, 1),
        round(v?.spo2Min, 1),
        round(napMin),
        dayLogs[n.wakeDate]?.sleepRating,
        nightTags(dayLogs, n.wakeDate).join('; '),
        m ? (m.session.origin ?? m.session.source) : undefined,
      ];
    });
}

/** Every night as CSV, oldest first. */
export function nightsCsv(input: NightsCsvInput): string {
  return toCsv(NIGHT_CSV_COLUMNS, nightCsvRows(input));
}

/** Every recorded night, including those older than the analysis window. */
export function allNights(data: SleepDataset, now: number, preferredOrigins?: string[]): Night[] {
  const today = dateKey(now);
  return buildNights(analyzeSessions(data.sessions.filter((x) => x.start < now), { preferredOrigins })).filter((n) => n.wakeDate <= today);
}

/** CSV of `nights` (see {@link allNights}), scoring nights the analysis didn't cover with the same model. */
export function exportNightsCsv(a: Analysis, data: SleepDataset, nights: Night[]): string {
  const scores: Record<string, SleepScore> = { ...a.scores };
  for (const n of nights) {
    if (n.main && !scores[n.main.id]) {
      scores[n.main.id] = scoreSleep(n.main, { needMin: a.need.needMin, age: a.age, habitualMidSleepMin: a.habitualMidSleepMin });
    }
  }
  return nightsCsv({ nights, scores, vitals: data.vitals, dayLogs: data.dayLogs });
}

// ---------------------------------------------------------------------------------------------
// Report data

export interface ReportNight {
  /** Wake date. */
  date: string;
  bedtime?: number;
  onset?: number;
  wake?: number;
  /** Main sleep, minutes asleep. */
  sleepMin?: number;
  napMin: number;
  inBedMin?: number;
  efficiency?: number;
  latencyMin?: number;
  wasoMin?: number;
  awakenings?: number;
  deepPct?: number;
  remPct?: number;
  score?: number;
  hrMin?: number;
  hrv?: number;
  spo2Avg?: number;
  debtMin: number;
  tags: string[];
}

export interface ReportData {
  generatedAt: number;
  from: string;
  to: string;
  days: number;
  name?: string;
  nightsRecorded: number;
  need: { needMin: number; lowMin: number; highMin: number; confidence: string; method: string; explanation: string };
  /** Main sleep + naps, per recorded night. */
  avgSleepMin?: number;
  nightsMeetingNeed: number;
  avgInBedMin?: number;
  avgEfficiency?: number;
  avgLatencyMin?: number;
  avgWasoMin?: number;
  avgAwakenings?: number;
  avgScore?: number;
  debt: { nowMin: number; startMin: number; category: string };
  regularity: { sri?: number; label: string; consistencyScore?: number };
  timing: { onsetMin?: number; wakeMin?: number; onsetSdMin?: number };
  chronotype?: { label: string; description: string; socialJetlagMin?: number };
  vitals: { hrMin?: number; hrv?: number; spo2Avg?: number };
  insights: { title: string; detail: string; kind: 'positive' | 'negative' | 'neutral' }[];
  screenings: { title: string; score: number; label: string; date: string }[];
  cbti?: { week: number; startedAt: string; window: string; efficiency?: number };
  rows: ReportNight[];
}

const avg = (xs: (number | undefined)[]): number | undefined => {
  const d = xs.filter((x): x is number => x !== undefined && Number.isFinite(x));
  return d.length ? mean(d) : undefined;
};

/** Report figures for the `days` mornings ending on the analysis day. */
export function buildReportData(
  a: Analysis,
  data: SleepDataset,
  opts: { days?: number; cbti?: CbtiProgram; name?: string; now?: number } = {},
): ReportData {
  const days = opts.days ?? 30;
  const trend = trendRows(a, data, days);
  const byDate = new Map(a.nights.map((n) => [n.wakeDate, n]));
  const rows: ReportNight[] = trend.map((t) => {
    const n = byDate.get(t.date);
    const m = n?.main;
    const v = m ? data.vitals[m.id] : undefined;
    return {
      date: t.date,
      bedtime: m?.start,
      onset: m?.sleepOnset,
      wake: m?.finalWake,
      sleepMin: m?.totalSleepMin,
      napMin: t.napMin,
      inBedMin: m?.timeInBedMin,
      efficiency: m?.efficiency,
      latencyMin: m?.latencyMin,
      wasoMin: m?.wasoMin,
      awakenings: m?.awakenings,
      deepPct: m?.stagePct?.deep,
      remPct: m?.stagePct?.rem,
      score: t.score,
      hrMin: v?.hrMin,
      hrv: t.hrv,
      spo2Avg: v?.spo2Avg,
      debtMin: t.debtMin,
      tags: nightTags(data.dayLogs, t.date),
    };
  });
  const recorded = rows.filter((r) => r.sleepMin !== undefined);
  const totals = recorded.map((r) => r.sleepMin! + r.napMin);
  const need = a.need;
  const chrono = a.chronotype.category ? CHRONOTYPE_LABELS[a.chronotype.category] : undefined;
  const onsets = recorded.map((r) => minutesOfDay(r.onset!));

  const screenings: ReportData['screenings'] = [];
  for (const id of Object.keys(QUIZZES) as Quiz['id'][]) {
    const s = data.profile.screenings[id];
    if (!s) continue;
    screenings.push({ title: QUIZZES[id].title, score: s.score, label: scoreQuiz(id, s.answers).band.label, date: s.date });
  }

  let cbti: ReportData['cbti'];
  if (opts.cbti?.active) {
    const s = cbtiStatus(opts.cbti, a.nights, a.day);
    cbti = {
      week: s.week,
      startedAt: opts.cbti.startedAt,
      window: `${formatClock(s.bedMin)}–${formatClock(s.wakeMin)} (${formatDuration(s.windowMin)})`,
      efficiency: s.current.efficiency ?? s.lastCompleted?.efficiency,
    };
  }

  return {
    generatedAt: opts.now ?? a.now,
    from: trend[0]?.date ?? a.day,
    to: a.day,
    days,
    name: opts.name ?? data.profile.name,
    nightsRecorded: recorded.length,
    need: {
      needMin: need.needMin,
      lowMin: need.lowMin,
      highMin: need.highMin,
      confidence: need.confidence,
      method: need.method,
      explanation: need.explanation,
    },
    avgSleepMin: avg(totals),
    nightsMeetingNeed: totals.filter((t) => t >= need.needMin - 15).length,
    avgInBedMin: avg(recorded.map((r) => r.inBedMin)),
    avgEfficiency: avg(recorded.map((r) => r.efficiency)),
    avgLatencyMin: avg(recorded.map((r) => r.latencyMin)),
    avgWasoMin: avg(recorded.map((r) => r.wasoMin)),
    avgAwakenings: avg(recorded.map((r) => r.awakenings)),
    avgScore: avg(recorded.map((r) => r.score)),
    debt: { nowMin: a.debt.debtMin, startMin: rows[0]?.debtMin ?? a.debt.debtMin, category: a.debt.category },
    regularity: { sri: a.regularity.sri, label: a.regularity.label, consistencyScore: a.regularity.consistencyScore },
    timing: {
      onsetMin: circularMeanMinutes(onsets),
      wakeMin: circularMeanMinutes(recorded.map((r) => minutesOfDay(r.wake!))),
      onsetSdMin: circularSdMinutes(onsets),
    },
    chronotype: chrono ? { label: chrono.label, description: chrono.description, socialJetlagMin: a.chronotype.socialJetlagMin } : undefined,
    vitals: { hrMin: avg(recorded.map((r) => r.hrMin)), hrv: avg(recorded.map((r) => r.hrv)), spo2Avg: avg(recorded.map((r) => r.spo2Avg)) },
    insights: a.insights.slice(0, 5).map((i) => ({ title: i.title, detail: i.detail, kind: i.kind })),
    screenings,
    cbti,
    rows,
  };
}

// ---------------------------------------------------------------------------------------------
// SVG charts (strings, for the printed report)

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Print palette (light surface). Validated: main sleep vs naps pass CVD separation. */
export const REPORT_COLORS = {
  surface: '#ffffff',
  ink: '#1d1b2c',
  inkSecondary: '#5f5c72',
  inkMuted: '#8a879b',
  grid: '#e7e5ef',
  panel: '#f5f4fa',
  main: '#5b4bd6',
  nap: '#2a9d8f',
  good: '#0a7f3f',
  warn: '#a35a00',
};

const C = REPORT_COLORS;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const f1 = (x: number) => x.toFixed(1);

/** "Mon 5 Oct". */
export function reportDate(key: string): string {
  const d = new Date(startOfDateKey(key) + 12 * 3600_000);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const dayNum = (key: string) => String(Number(key.slice(8, 10)));

/** Column with a 4px rounded data-end and a square base. */
function column(x: number, y: number, w: number, h: number, fill: string, rounded = true): string {
  if (h <= 0) return '';
  const r = rounded ? Math.min(4, w / 2, h) : 0;
  const base = y + h;
  return `<path d="M${f1(x)},${f1(base)} V${f1(y + r)} Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)} H${f1(x + w - r)} Q${f1(x + w)},${f1(y)} ${f1(x + w)},${f1(y + r)} V${f1(base)} Z" fill="${fill}"/>`;
}

const svgOpen = (w: number, h: number, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${escapeHtml(label)}" font-family="inherit">`;

/** Nightly sleep (main + naps stacked) against the sleep-need line. */
export function svgSleepChart(rows: ReportNight[], needMin: number, w = 700, h = 190): string {
  const left = 34;
  const top = 12;
  const axisH = 18;
  const plotW = w - left - 4;
  const plotH = h - top - axisH;
  const maxMin = Math.max(needMin * 1.25, ...rows.map((r) => (r.sleepMin ?? 0) + r.napMin));
  const maxH = Math.ceil(maxMin / 120) * 2;
  const y = (min: number) => top + plotH - (min / (maxH * 60)) * plotH;
  const slot = plotW / Math.max(1, rows.length);
  const bw = Math.min(24, Math.max(2, slot * 0.62));
  const every = Math.ceil(rows.length / 15);
  const out: string[] = [svgOpen(w, h, 'Nightly sleep against sleep need')];
  for (let hr = 0; hr <= maxH; hr += 2) {
    out.push(`<line x1="${left}" x2="${w}" y1="${f1(y(hr * 60))}" y2="${f1(y(hr * 60))}" stroke="${C.grid}" stroke-width="1"/>`);
    out.push(`<text x="${left - 6}" y="${f1(y(hr * 60) + 3.5)}" font-size="10" fill="${C.inkMuted}" text-anchor="end">${hr}h</text>`);
  }
  rows.forEach((r, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    if (r.sleepMin === undefined && !r.napMin) {
      out.push(`<rect x="${f1(x)}" y="${f1(y(0) - 2)}" width="${f1(bw)}" height="2" fill="${C.grid}"/>`);
    } else {
      const main = r.sleepMin ?? 0;
      const yMain = y(main);
      out.push(column(x, yMain, bw, y(0) - yMain, C.main, !r.napMin));
      if (r.napMin) {
        const yTop = y(main + r.napMin);
        out.push(column(x, yTop, bw, yMain - (main ? 2 : 0) - yTop, C.nap));
      }
    }
    if (i % every === 0) out.push(`<text x="${f1(x + bw / 2)}" y="${h - 4}" font-size="10" fill="${C.inkMuted}" text-anchor="middle">${dayNum(r.date)}</text>`);
  });
  const yn = f1(y(needMin));
  out.push(`<line x1="${left}" x2="${w}" y1="${yn}" y2="${yn}" stroke="${C.ink}" stroke-width="1"/>`);
  out.push(
    `<text x="${w - 2}" y="${f1(y(needMin) - 5)}" font-size="10" fill="${C.ink}" text-anchor="end" paint-order="stroke" stroke="${C.surface}" stroke-width="3">need ${formatDuration(needMin)}</text>`,
  );
  out.push('</svg>');
  return out.join('');
}

/** Sleep timing per night on a 20:00 → 12:00 axis. */
export function svgTimingChart(rows: ReportNight[], w = 700, h = 170): string {
  const left = 40;
  const top = 8;
  const axisH = 18;
  const plotW = w - left - 4;
  const plotH = h - top - axisH;
  const toY = (m: number) => top + (((m - 20 * 60 + 1440) % 1440) / (16 * 60)) * plotH;
  const slot = plotW / Math.max(1, rows.length);
  const bw = Math.min(16, Math.max(2, slot * 0.5));
  const every = Math.ceil(rows.length / 15);
  const out: string[] = [svgOpen(w, h, 'Sleep timing per night')];
  for (const hr of [20, 0, 4, 8, 12]) {
    const yy = f1(toY(hr * 60));
    out.push(`<line x1="${left}" x2="${w}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`);
    out.push(`<text x="${left - 6}" y="${f1(toY(hr * 60) + 3.5)}" font-size="10" fill="${C.inkMuted}" text-anchor="end">${formatClock(hr * 60)}</text>`);
  }
  rows.forEach((r, i) => {
    const x = left + i * slot + (slot - bw) / 2;
    if (r.onset !== undefined && r.wake !== undefined) {
      const y1 = toY(minutesOfDay(r.onset));
      const y2 = toY(minutesOfDay(r.wake));
      if (y2 > y1) out.push(`<rect x="${f1(x)}" y="${f1(y1)}" width="${f1(bw)}" height="${f1(y2 - y1)}" rx="${f1(Math.min(4, bw / 2))}" fill="${C.main}"/>`);
    }
    if (i % every === 0) out.push(`<text x="${f1(x + bw / 2)}" y="${h - 4}" font-size="10" fill="${C.inkMuted}" text-anchor="middle">${dayNum(r.date)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

/** A single-series line (2px, 10% area wash, labelled end dot). */
export function svgLineChart(
  values: (number | undefined)[],
  labels: string[],
  opts: { w?: number; h?: number; minY?: number; format: (v: number) => string; label: string },
): string {
  const w = opts.w ?? 700;
  const h = opts.h ?? 130;
  const left = 34;
  const right = 46;
  const top = 12;
  const axisH = 18;
  const plotW = w - left - right;
  const plotH = h - top - axisH;
  const defined = values.filter((v): v is number => v !== undefined);
  const out: string[] = [svgOpen(w, h, opts.label)];
  if (defined.length < 2) {
    out.push(`<text x="${w / 2}" y="${h / 2}" font-size="11" fill="${C.inkMuted}" text-anchor="middle">Not enough data</text></svg>`);
    return out.join('');
  }
  const lo = opts.minY ?? Math.min(...defined);
  let hi = Math.max(...defined);
  if (hi - lo < 1e-6) hi = lo + 1;
  const x = (i: number) => left + (values.length === 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
  const y = (v: number) => top + plotH - ((v - lo) / (hi - lo)) * plotH;
  for (const t of [lo, (lo + hi) / 2, hi]) {
    out.push(`<line x1="${left}" x2="${left + plotW}" y1="${f1(y(t))}" y2="${f1(y(t))}" stroke="${C.grid}" stroke-width="1"/>`);
    out.push(`<text x="${left - 6}" y="${f1(y(t) + 3.5)}" font-size="10" fill="${C.inkMuted}" text-anchor="end">${escapeHtml(opts.format(t))}</text>`);
  }
  let d = '';
  let pen = false;
  let first = -1;
  let last = -1;
  values.forEach((v, i) => {
    if (v === undefined) {
      pen = false;
      return;
    }
    if (first < 0) first = i;
    last = i;
    d += `${pen ? 'L' : 'M'}${f1(x(i))},${f1(y(v))} `;
    pen = true;
  });
  if (first >= 0 && values.every((v, i) => i < first || i > last || v !== undefined)) {
    out.push(`<path d="${d}L${f1(x(last))},${f1(y(lo))} L${f1(x(first))},${f1(y(lo))} Z" fill="${C.main}" opacity="0.1"/>`);
  }
  out.push(`<path d="${d.trim()}" fill="none" stroke="${C.main}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  const end = values[last]!;
  out.push(`<circle cx="${f1(x(last))}" cy="${f1(y(end))}" r="4" fill="${C.main}" stroke="${C.surface}" stroke-width="2"/>`);
  out.push(`<text x="${f1(x(last) + 8)}" y="${f1(y(end) + 3.5)}" font-size="10.5" font-weight="600" fill="${C.ink}">${escapeHtml(opts.format(end))}</text>`);
  const every = Math.ceil(labels.length / 15);
  labels.forEach((l, i) => {
    if (i % every === 0) out.push(`<text x="${f1(x(i))}" y="${h - 4}" font-size="10" fill="${C.inkMuted}" text-anchor="middle">${escapeHtml(l)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

// ---------------------------------------------------------------------------------------------
// HTML report

const dash = '–';
const dur = (m?: number) => (m === undefined ? dash : formatDuration(m));
const pctText = (x?: number, digits = 0) => (x === undefined ? dash : `${(x * 100).toFixed(digits)}%`);
const clock = (t?: number) => (t === undefined ? dash : formatTime(t));
const num = (x?: number, digits = 0) => (x === undefined ? dash : x.toFixed(digits));

function stat(label: string, value: string, sub?: string): string {
  return `<td class="stat"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(value)}</div>${sub ? `<div class="s">${escapeHtml(sub)}</div>` : ''}</td>`;
}

function debtSub(r: ReportData): string {
  const change = r.debt.nowMin - r.debt.startMin;
  if (Math.abs(change) < 15) return `steady over ${r.days} days`;
  return `${change > 0 ? 'up' : 'down'} ${formatDuration(Math.abs(change))} over ${r.days} days`;
}

function sriText(r: ReportData): string {
  if (r.regularity.sri !== undefined) return `${Math.round(r.regularity.sri)}`;
  if (r.regularity.consistencyScore !== undefined) return `${Math.round(r.regularity.consistencyScore)}/100`;
  return dash;
}

const STYLE = `
@page { size: A4; margin: 12mm 11mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: ${C.surface}; }
body { font-family: -apple-system, Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: ${C.ink}; font-size: 11px; line-height: 1.4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { max-width: 760px; margin: 0 auto; padding: 4px 2px; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${C.main}; padding-bottom: 8px; }
h1 { font-size: 20px; margin: 0; letter-spacing: -0.01em; }
h1 span { color: ${C.main}; }
h2 { font-size: 12.5px; margin: 0 0 6px; }
.meta { color: ${C.inkSecondary}; font-size: 10.5px; text-align: right; }
.sub { color: ${C.inkSecondary}; margin-top: 2px; }
.stats { border-collapse: separate; border-spacing: 6px; margin: 8px -6px 0; table-layout: fixed; width: calc(100% + 12px); }
.stat { background: ${C.panel}; border-radius: 8px; padding: 7px 9px; vertical-align: top; }
.stat .k { font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.inkSecondary}; }
.stat .v { font-size: 16px; font-weight: 600; margin-top: 2px; }
.stat .s { font-size: 9.5px; color: ${C.inkSecondary}; margin-top: 1px; }
section { margin-top: 14px; page-break-inside: avoid; break-inside: avoid; }
.legend { display: flex; gap: 14px; color: ${C.inkSecondary}; font-size: 10px; margin: -2px 0 4px; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
.note { color: ${C.inkSecondary}; font-size: 9.5px; margin-top: 3px; }
ul.insights { margin: 0; padding: 0; list-style: none; }
ul.insights li { padding: 5px 0 5px 10px; border-left: 3px solid ${C.grid}; margin-bottom: 4px; }
ul.insights li.positive { border-left-color: ${C.good}; }
ul.insights li.negative { border-left-color: ${C.warn}; }
ul.insights b { display: block; }
.cols { display: flex; gap: 14px; }
.cols > div { flex: 1; }
table.list { width: 100%; border-collapse: collapse; }
table.list td { padding: 3px 0; border-bottom: 1px solid ${C.grid}; }
table.list td:last-child { text-align: right; color: ${C.inkSecondary}; }
table.nights { width: 100%; border-collapse: collapse; font-size: 9px; font-variant-numeric: tabular-nums; }
table.nights th { text-align: right; font-weight: 600; color: ${C.inkSecondary}; border-bottom: 1px solid ${C.inkMuted}; padding: 3px 4px; white-space: nowrap; }
table.nights td { text-align: right; padding: 2.5px 4px; border-bottom: 1px solid ${C.grid}; white-space: nowrap; }
table.nights th:first-child, table.nights td:first-child, table.nights th:last-child, table.nights td:last-child { text-align: left; }
table.nights td:last-child { white-space: normal; color: ${C.inkSecondary}; }
table.nights tr.missing td { color: ${C.inkMuted}; }
table.nights tr { page-break-inside: avoid; break-inside: avoid; }
thead { display: table-header-group; }
footer { margin-top: 16px; padding-top: 6px; border-top: 1px solid ${C.grid}; color: ${C.inkMuted}; font-size: 9px; }
`;

/** A self-contained, print-ready HTML document (A4). */
export function reportHtml(r: ReportData): string {
  const need = r.need;
  const generated = new Date(r.generatedAt);
  const generatedText = `${reportDate(dateKey(r.generatedAt))} ${generated.getFullYear()}, ${formatTime(r.generatedAt)}`;
  const avgVsNeed = r.avgSleepMin === undefined ? undefined : r.avgSleepMin - need.needMin;

  const statsRows = [
    [
      stat('Average sleep', dur(r.avgSleepMin), avgVsNeed === undefined ? undefined : `${avgVsNeed >= 0 ? '+' : '−'}${formatDuration(Math.abs(avgVsNeed))} vs need`),
      stat('Nights meeting need', `${r.nightsMeetingNeed} / ${r.nightsRecorded}`, `within 15 min of ${formatDuration(need.needMin)}`),
      stat('Sleep score', r.avgScore === undefined ? dash : String(Math.round(r.avgScore)), 'average, 0–100'),
      stat('Sleep debt', formatDuration(r.debt.nowMin), debtSub(r)),
    ],
    [
      stat('Sleep need (est.)', formatDuration(need.needMin), `${formatDuration(need.lowMin)}–${formatDuration(need.highMin)} · ${need.confidence} confidence`),
      stat('Regularity (SRI)', sriText(r), r.regularity.label),
      stat(
        'Typical timing',
        r.timing.onsetMin === undefined || r.timing.wakeMin === undefined ? dash : `${formatClock(r.timing.onsetMin)}–${formatClock(r.timing.wakeMin)}`,
        r.timing.onsetSdMin === undefined ? 'sleep onset → wake' : `onset varies ±${Math.round(r.timing.onsetSdMin)} min`,
      ),
      stat('Chronotype', r.chronotype?.label ?? dash, r.chronotype?.socialJetlagMin !== undefined ? `social jet lag ${formatDuration(Math.abs(r.chronotype.socialJetlagMin))}` : undefined),
    ],
    [
      stat('Sleep efficiency', pctText(r.avgEfficiency), 'asleep ÷ in bed'),
      stat('Time to fall asleep', r.avgLatencyMin === undefined ? dash : `${Math.round(r.avgLatencyMin)} min`, 'average'),
      stat('Awake after sleep onset', r.avgWasoMin === undefined ? dash : `${Math.round(r.avgWasoMin)} min`, r.avgAwakenings === undefined ? undefined : `${r.avgAwakenings.toFixed(1)} awakenings a night`),
      stat(
        'Overnight vitals',
        r.vitals.hrMin === undefined ? dash : `${Math.round(r.vitals.hrMin)} bpm`,
        [r.vitals.hrv !== undefined ? `HRV ${Math.round(r.vitals.hrv)} ms` : '', r.vitals.spo2Avg !== undefined ? `SpO₂ ${r.vitals.spo2Avg.toFixed(1)}%` : '']
          .filter(Boolean)
          .join(' · ') || 'min heart rate',
      ),
    ],
  ];

  const insights = r.insights.length
    ? `<ul class="insights">${r.insights.map((i) => `<li class="${i.kind}"><b>${escapeHtml(i.title)}</b>${escapeHtml(i.detail)}</li>`).join('')}</ul>`
    : `<div class="note">No clear patterns yet. Insights appear after a few weeks of nights and journal tags.</div>`;

  const screenings = r.screenings.length
    ? `<table class="list">${r.screenings.map((s) => `<tr><td>${escapeHtml(s.title)}: <b>${s.score}</b> · ${escapeHtml(s.label)}</td><td>${escapeHtml(s.date)}</td></tr>`).join('')}</table>`
    : `<div class="note">No self-checks completed.</div>`;

  const cbti = r.cbti
    ? `<table class="list"><tr><td>Insomnia programme (CBT-I), week <b>${r.cbti.week}</b></td><td>since ${escapeHtml(reportDate(r.cbti.startedAt))}</td></tr><tr><td>Prescribed time in bed</td><td>${escapeHtml(r.cbti.window)}</td></tr><tr><td>Sleep efficiency (current week)</td><td>${pctText(r.cbti.efficiency)}</td></tr></table>`
    : '';

  const tableRows = [...r.rows]
    .reverse()
    .map((n) => {
      if (n.sleepMin === undefined) {
        return `<tr class="missing"><td>${escapeHtml(reportDate(n.date))}</td><td colspan="11" style="text-align:left">${n.napMin ? `naps only (${formatDuration(n.napMin)})` : 'no data'}</td><td>${escapeHtml(n.tags.join(', '))}</td></tr>`;
      }
      return `<tr><td>${escapeHtml(reportDate(n.date))}</td><td>${clock(n.bedtime)}</td><td>${clock(n.onset)}</td><td>${clock(n.wake)}</td><td>${dur(n.sleepMin)}</td><td>${n.napMin ? formatDuration(n.napMin) : ''}</td><td>${pctText(n.efficiency)}</td><td>${num(n.latencyMin)}</td><td>${num(n.wasoMin)}</td><td>${n.deepPct === undefined ? dash : `${Math.round(n.deepPct * 100)}/${Math.round((n.remPct ?? 0) * 100)}`}</td><td>${num(n.score)}</td><td>${num(n.hrMin)}${n.hrv !== undefined ? ` / ${Math.round(n.hrv)}` : ''}</td><td>${escapeHtml(n.tags.join(', '))}</td></tr>`;
    })
    .join('');

  const labels = r.rows.map((x) => dayNum(x.date));
  const title = `Sleep report ${reportDate(r.from)} – ${reportDate(r.to)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="page">
<header>
  <div>
    <h1><span>eepy</span> sleep report</h1>
    <div class="sub">${escapeHtml(reportDate(r.from))} – ${escapeHtml(reportDate(r.to))} ${new Date(startOfDateKey(r.to)).getFullYear()} · ${r.days} days · ${r.nightsRecorded} nights recorded</div>
  </div>
  <div class="meta">${r.name ? `${escapeHtml(r.name)}<br>` : ''}Generated ${escapeHtml(generatedText)}</div>
</header>

<table class="stats">${statsRows.map((row) => `<tr>${row.join('')}</tr>`).join('')}</table>

<section>
  <h2>Sleep each night vs. need</h2>
  <div class="legend"><span><i style="background:${C.main}"></i>Main sleep</span><span><i style="background:${C.nap}"></i>Naps</span><span>Line: estimated need ${formatDuration(need.needMin)}</span></div>
  ${svgSleepChart(r.rows, need.needMin)}
</section>

<section>
  <h2>Sleep timing (sleep onset → wake)</h2>
  ${svgTimingChart(r.rows)}
  <div class="note">Each bar runs from falling asleep to final wake. Bars that line up mean a regular body clock.</div>
</section>

<section>
  <h2>Sleep debt</h2>
  ${svgLineChart(r.rows.map((x) => x.debtMin / 60), labels, { minY: 0, format: (v) => `${v.toFixed(1)}h`, label: 'Sleep debt over the period' })}
  <div class="note">Rolling 14-night shortfall against the estimated need, recent nights weighted more. Under 2 h is low.</div>
</section>

<section class="cols">
  <div>
    <h2>What stands out</h2>
    ${insights}
  </div>
  <div>
    <h2>Self-checks</h2>
    ${screenings}
    ${cbti ? `<h2 style="margin-top:12px">Treatment</h2>${cbti}` : ''}
    <h2 style="margin-top:12px">About the sleep-need estimate</h2>
    <div class="note">${escapeHtml(need.explanation)}</div>
  </div>
</section>

<section style="page-break-inside:auto;break-inside:auto">
  <h2>Night by night</h2>
  <table class="nights">
    <thead><tr><th>Morning</th><th>In bed</th><th>Asleep</th><th>Wake</th><th>Sleep</th><th>Naps</th><th>Eff.</th><th>Latency</th><th>WASO</th><th>Deep/REM %</th><th>Score</th><th>HR min / HRV</th><th>Tags (evening before)</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div class="note">Latency and WASO (wake after sleep onset) in minutes. HR in bpm, HRV (RMSSD) in ms.</div>
</section>

<footer>Generated by eepy from CMF Watch data via Health Connect. Consumer wearables estimate sleep stages and timing; these figures are not a medical diagnosis.</footer>
</div>
</body>
</html>`;
}

/** File-name friendly report name, e.g. "eepy-sleep-report-2026-09-30-to-2026-10-29". */
export function reportFileBase(r: Pick<ReportData, 'from' | 'to'>): string {
  return `eepy-sleep-report-${r.from}-to-${r.to}`;
}
