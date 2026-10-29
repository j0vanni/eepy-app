import { analyze } from '../analysis';
import { generateDemoData } from '../demo';
import {
  allNights,
  buildReportData,
  csvCell,
  csvRow,
  escapeHtml,
  exportNightsCsv,
  localStamp,
  NIGHT_CSV_COLUMNS,
  nightCsvRows,
  nightsCsv,
  nightTags,
  reportDate,
  reportFileBase,
  reportHtml,
  svgLineChart,
  svgSleepChart,
  svgTimingChart,
  toCsv,
} from '../export';
import { analyzeSessions, buildNights } from '../sessions';
import { atMinutes } from '../time';
import type { DayLog, SleepSession } from '../types';
import { night, profile } from './helpers';

/** Minimal RFC 4180 parser, to check that what we write reads back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

describe('CSV cells', () => {
  it('leaves plain values alone', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(87.5)).toBe('87.5');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(NaN)).toBe('');
    expect(csvCell(-3)).toBe('-3');
  });

  it('quotes commas, quotes, line breaks and edge spaces', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('cr\r\nlf')).toBe('"cr\r\nlf"');
    expect(csvCell(' padded ')).toBe('" padded "');
  });

  it('defuses spreadsheet formulas in text', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-x')).toBe("'-x");
  });

  it('builds rows and documents with CRLF and a trailing newline', () => {
    expect(csvRow(['a', 1, undefined, 'b,c'])).toBe('a,1,,"b,c"');
    expect(toCsv(['x', 'y'], [[1, 2], ['a', 'b']])).toBe('x,y\r\n1,2\r\na,b\r\n');
    expect(toCsv(['x'], [])).toBe('x\r\n');
  });

  it('round-trips awkward text through a CSV parser', () => {
    const nasty = ['plain', 'comma, inside', 'quote " inside', 'multi\nline', '', '=1+1'];
    const parsed = parseCsv(toCsv(['a', 'b', 'c', 'd', 'e', 'f'], [nasty]));
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual(['plain', 'comma, inside', 'quote " inside', 'multi\nline', '', "'=1+1"]);
  });
});

describe('nights CSV', () => {
  const sessions: SleepSession[] = [
    night('2026-10-01', 23 * 60, 7.5, { latencyMin: 12, origin: 'com.nothing.smartcenter', id: 'a' }),
    night('2026-10-02', 23 * 60 + 30, 6, { latencyMin: 20, staged: false, id: 'b' }),
    night('2026-10-03', 22 * 60 + 45, 8, { latencyMin: 8, id: 'c' }),
    { id: 'nap', source: 'manual', start: atMinutes('2026-10-06', 14 * 60), end: atMinutes('2026-10-06', 14 * 60 + 25), stages: [], kind: 'nap' },
  ];
  const nights = buildNights(analyzeSessions(sessions));
  const dayLogs: Record<string, DayLog> = {
    '2026-10-01': { date: '2026-10-01', tags: ['alcohol', 'late-caffeine'] },
    '2026-10-02': { date: '2026-10-02', tags: ['my, "custom" tag'], sleepRating: 4 },
    '2026-10-03': { date: '2026-10-03', tags: [], sleepRating: 2 },
  };
  const input = {
    nights,
    scores: { a: { total: 81, label: 'Good' as const, components: [] } },
    vitals: { a: { sessionId: 'a', hrMin: 52.4, hrAvg: 58.6, hrvRmssd: 41.25, spo2Avg: 96.44, spo2Min: 91 } },
    dayLogs,
  };

  it('has the documented header and one row per night', () => {
    const csv = nightsCsv(input);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...NIGHT_CSV_COLUMNS]);
    expect(rows[0]).toEqual(
      expect.arrayContaining(['date', 'bedtime', 'sleep_onset', 'wake', 'total_sleep_min', 'light_min', 'deep_min', 'rem_min', 'awake_min', 'latency_min', 'waso_min', 'awakenings', 'efficiency_pct', 'score', 'hr_min_bpm', 'hr_avg_bpm', 'hrv_rmssd_ms', 'spo2_avg_pct', 'tags']),
    );
    expect(rows).toHaveLength(1 + nights.length);
    expect(nights.length).toBe(4);
    for (const r of rows) expect(r).toHaveLength(NIGHT_CSV_COLUMNS.length);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('fills a staged night with its metrics and vitals', () => {
    const [header, first] = parseCsv(nightsCsv(input));
    const row = Object.fromEntries(header.map((h, i) => [h, first[i]]));
    expect(row.date).toBe('2026-10-02');
    expect(row.bedtime).toBe('2026-10-01 22:48');
    expect(row.sleep_onset).toBe('2026-10-01 23:00');
    expect(row.wake).toBe('2026-10-02 06:30');
    expect(row.total_sleep_min).toBe('450');
    expect(row.time_in_bed_min).toBe('462');
    expect(row.latency_min).toBe('12');
    expect(Number(row.light_min) + Number(row.deep_min) + Number(row.rem_min)).toBe(450);
    expect(row.awake_min).toBe('12');
    expect(row.efficiency_pct).toBe('97.4');
    expect(row.score).toBe('81');
    expect(row.hr_min_bpm).toBe('52');
    expect(row.hr_avg_bpm).toBe('59');
    expect(row.hrv_rmssd_ms).toBe('41.3');
    expect(row.spo2_avg_pct).toBe('96.4');
    expect(row.tags).toBe('Alcohol; Late caffeine');
    expect(row.source).toBe('com.nothing.smartcenter');
  });

  it('leaves stage columns empty for unstaged nights and escapes custom tags', () => {
    const rows = parseCsv(nightsCsv(input));
    const row = Object.fromEntries(rows[0].map((h, i) => [h, rows[2][i]]));
    expect(row.date).toBe('2026-10-03');
    expect(row.light_min).toBe('');
    expect(row.deep_min).toBe('');
    expect(row.rem_min).toBe('');
    expect(row.total_sleep_min).toBe('360');
    expect(row.tags).toBe('my, "custom" tag');
    expect(row.sleep_rating).toBe('2');
    expect(row.source).toBe('manual');
    expect(nightsCsv(input)).toContain('"my, ""custom"" tag"');
  });

  it('includes nap-only days with the sleep columns blank', () => {
    const rows = nightCsvRows(input);
    const nap = rows[rows.length - 1];
    expect(nap[0]).toBe('2026-10-06');
    expect(nap[1]).toBeUndefined();
    expect(nap[NIGHT_CSV_COLUMNS.indexOf('total_sleep_min')]).toBeUndefined();
    expect(nap[NIGHT_CSV_COLUMNS.indexOf('nap_min')]).toBe(25);
    expect(rows[2][NIGHT_CSV_COLUMNS.indexOf('nap_min')]).toBe(0);
    expect(rows[0][NIGHT_CSV_COLUMNS.indexOf('sleep_rating')]).toBe(4);
  });

  it('sorts oldest first regardless of input order', () => {
    const rows = nightCsvRows({ ...input, nights: [...nights].reverse() });
    expect(rows.map((r) => r[0])).toEqual(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-06']);
  });

  it('maps evening tags to the night that follows', () => {
    expect(nightTags(dayLogs, '2026-10-02')).toEqual(['Alcohol', 'Late caffeine']);
    expect(nightTags(dayLogs, '2026-10-10')).toEqual([]);
    expect(localStamp(atMinutes('2026-10-01', 23 * 60 + 5))).toBe('2026-10-01 23:05');
  });

  it('exports nights older than the analysis window, scored like the rest', () => {
    const now = atMinutes('2026-10-29', 9 * 60);
    const data = generateDemoData(now, { days: 200 });
    const a = analyze(data, now);
    const nights = allNights(data, now);
    expect(nights.length).toBeGreaterThan(a.nights.length + 60);
    const rows = parseCsv(exportNightsCsv(a, data, nights));
    expect(rows).toHaveLength(nights.length + 1);
    const scoreCol = rows[0].indexOf('score');
    expect(rows[1][0] < a.nights[0].wakeDate).toBe(true);
    expect(Number(rows[1][scoreCol])).toBeGreaterThan(0);
    // Nights inside the window keep the analysis' score.
    const last = a.nights[a.nights.length - 1];
    expect(rows[rows.length - 1][scoreCol]).toBe(String(a.scores[last.main!.id].total));
  });

  it('exports every demo night', () => {
    const now = atMinutes('2026-10-29', 9 * 60);
    const data = generateDemoData(now);
    const a = analyze(data, now);
    const csv = nightsCsv({ nights: a.nights, scores: a.scores, vitals: data.vitals, dayLogs: data.dayLogs });
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(a.nights.length + 1);
    expect(rows.every((r) => r.length === NIGHT_CSV_COLUMNS.length)).toBe(true);
  });
});

describe('PDF report', () => {
  const now = atMinutes('2026-10-29', 9 * 60);
  const data = generateDemoData(now);
  data.profile = { ...data.profile, name: 'Ada <script>' };
  const a = analyze(data, now);
  const r = buildReportData(a, data, { days: 30 });

  it('covers the last 30 mornings', () => {
    expect(r.rows).toHaveLength(30);
    expect(r.to).toBe('2026-10-29');
    expect(r.from).toBe('2026-09-30');
    expect(r.days).toBe(30);
    expect(r.nightsRecorded).toBeGreaterThan(20);
    expect(r.nightsRecorded).toBeLessThanOrEqual(30);
    expect(reportFileBase(r)).toBe('eepy-sleep-report-2026-09-30-to-2026-10-29');
  });

  it('summarises the key stats', () => {
    expect(r.avgSleepMin).toBeGreaterThan(5 * 60);
    expect(r.avgSleepMin).toBeLessThan(10 * 60);
    expect(r.need.needMin).toBe(a.need.needMin);
    expect(r.avgScore).toBeGreaterThan(30);
    expect(r.avgEfficiency).toBeGreaterThan(0.5);
    expect(r.avgEfficiency).toBeLessThanOrEqual(1);
    expect(r.debt.nowMin).toBe(a.debt.debtMin);
    expect(r.debt.startMin).toBe(r.rows[0].debtMin);
    expect(r.timing.onsetMin).toBeDefined();
    expect(r.insights.length).toBeLessThanOrEqual(5);
    expect(r.nightsMeetingNeed).toBeLessThanOrEqual(r.nightsRecorded);
  });

  it('renders a self-contained, escaped HTML document', () => {
    const html = reportHtml(r);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('Ada &lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/); // nothing remote: works offline in the print WebView
    expect((html.match(/<svg /g) ?? []).length).toBe(3);
    expect((html.match(/<tr( class="missing")?><td>/g) ?? []).length).toBe(30);
    expect(html).toContain('Sleep each night vs. need');
    expect(html).toContain('Night by night');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
  });

  it('includes self-checks and an active CBT-I programme', () => {
    const withChecks = {
      ...data,
      profile: { ...data.profile, screenings: { isi: { score: 17, answers: [3, 3, 2, 3, 2, 2, 2], date: '2026-10-01' } } },
    };
    const program = { active: true, startedAt: '2026-10-19', wakeMin: 7 * 60, windowMin: 390, weeks: [] };
    const rr = buildReportData(a, withChecks, { cbti: program });
    expect(rr.screenings).toEqual([{ title: 'Insomnia check', score: 17, label: 'Moderate insomnia', date: '2026-10-01' }]);
    expect(rr.cbti?.week).toBe(2);
    const html = reportHtml(rr);
    expect(html).toContain('Insomnia programme (CBT-I), week <b>2</b>');
    expect(html).toContain('Moderate insomnia');
  });

  it('copes with a short history', () => {
    const fewNow = atMinutes('2026-10-29', 9 * 60);
    const few = [night('2026-10-27', 23 * 60, 7), night('2026-10-28', 23 * 60, 7.5)];
    const d = { sessions: few, vitals: {}, daily: {}, dayLogs: {}, caffeine: [], profile: profile() };
    const ra = analyze(d, fewNow);
    const rr = buildReportData(ra, d, { days: 30 });
    expect(rr.nightsRecorded).toBe(2);
    const html = reportHtml(rr);
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    expect((html.match(/<tr class="missing">/g) ?? []).length).toBe(28);
  });
});

describe('SVG charts', () => {
  const rows = [
    { date: '2026-10-01', sleepMin: 420, napMin: 0, onset: atMinutes('2026-09-30', 23 * 60), wake: atMinutes('2026-10-01', 6 * 60), debtMin: 60, tags: [] },
    { date: '2026-10-02', napMin: 30, debtMin: 90, tags: [] },
    { date: '2026-10-03', sleepMin: 480, napMin: 20, onset: atMinutes('2026-10-02', 23 * 60 + 30), wake: atMinutes('2026-10-03', 7 * 60 + 50), debtMin: 30, tags: [] },
  ];

  it('draws bars, a gap marker and the need line', () => {
    const svg = svgSleepChart(rows, 450);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('need 7h 30m');
    expect((svg.match(/<path /g) ?? []).length).toBe(4); // main + nap for night 3, main for night 1, nap-only night 2
    expect(svg).not.toContain('NaN');
  });

  it('draws one timing bar per night with times', () => {
    const svg = svgTimingChart(rows);
    expect((svg.match(/<rect /g) ?? []).length).toBe(2);
    expect(svg).not.toContain('NaN');
  });

  it('labels the line end and handles too little data', () => {
    const svg = svgLineChart([1, 1.5, 0.5], ['1', '2', '3'], { minY: 0, format: (v) => `${v.toFixed(1)}h`, label: 'Debt' });
    expect(svg).toContain('>0.5h</text>');
    expect(svg).toContain('<circle');
    expect(svgLineChart([1], ['1'], { format: String, label: 'x' })).toContain('Not enough data');
  });

  it('escapes HTML and formats dates', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(reportDate('2026-10-05')).toBe('Mon 5 Oct');
  });
});
