import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import type { Analysis } from '@/engine/analysis';
import { CAFFEINE_PRESETS } from '@/engine/caffeine';
import { baselineScenario, Scenario, SimulationResult, simulateTomorrow, SIM } from '@/engine/simulate';
import { atMinutes, formatDuration, formatTime, HOUR, MINUTE } from '@/engine/time';
import type { SleepDataset } from '@/engine/types';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { CompareChart } from '@/ui/CompareChart';
import { Button, Card, CardTitle, Chip, Empty, Icon, Screen } from '@/ui/components';
import { Slider } from '@/ui/Slider';
import { colors, font, radius, space } from '@/ui/theme';

const STEP = 5 * MINUTE;
const ceilStep = (t: number) => Math.ceil(t / STEP) * STEP;
const floorStep = (t: number) => Math.floor(t / STEP) * STEP;
const clampT = (t: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, t));

interface Coffee {
  id: string;
  time: number;
  mg: number;
  label: string;
}

/** What the user has changed, relative to tonight's plan. */
interface Draft {
  bedOffsetMin: number;
  wakeOffsetMin: number;
  nap?: { start: number; minutes: number };
  coffees: Coffee[];
}

const NO_CHANGES: Draft = { bedOffsetMin: 0, wakeOffsetMin: 0, coffees: [] };
const MAX_COFFEES = 3;
const DEFAULT_DRINK = CAFFEINE_PRESETS.find((p) => p.mg === 95) ?? CAFFEINE_PRESETS[0];
const shortLabel = (label: string) => label.replace(' / 240 ml', '');

/** Passes `value` through at most every `ms` while it keeps changing, so results follow a drag live. */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  latest.current = value;
  useEffect(() => {
    if (timer.current !== undefined) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setOut(latest.current);
    }, ms);
  }, [value, ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return out;
}

const signed = (d: number, text: string) => `${d > 0 ? '+' : '−'}${text}`;
const deltaMin = (d: number) => (Math.abs(d) < 1 ? '±0' : signed(d, formatDuration(Math.abs(d))));
const deltaNum = (d: number, digits = 0, unit = '') =>
  Math.abs(d) < 0.5 * 10 ** -digits ? '±0' : signed(d, `${Math.abs(d).toFixed(digits)}${unit}`);
/** Green when the change helps, amber when it hurts, faint when it's noise. */
const tone = (d: number, better: 'up' | 'down', noise: number) =>
  Math.abs(d) < noise ? colors.textFaint : (d > 0) === (better === 'up') ? colors.good : colors.warn;
const offsetLabel = (min: number, what = 'plan') =>
  min === 0 ? `on ${what}` : `${formatDuration(Math.abs(min))} ${min < 0 ? 'earlier' : 'later'} than ${what}`;

export default function SimulateScreen() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  if (!a) {
    return (
      <Screen>
        <Empty icon="tune-variant" title="No sleep data yet" body="Connect your watch or log a night, then try a bedtime, nap or coffee and see how tomorrow changes." />
      </Screen>
    );
  }
  return <Simulator a={a} data={data} />;
}

function Simulator({ a, data }: { a: Analysis; data: SleepDataset }) {
  const [draft, setDraft] = useState<Draft>(NO_CHANGES);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const base = useMemo(() => baselineScenario(a), [a]);

  // Slider ranges. Bedtime: ±3h around the plan but never in the past; naps/drinks from now until bed.
  const bedMinOff = Math.max(-180, -Math.floor((base.bedtime - a.now) / MINUTE / 5) * 5);
  const bedtime = base.bedtime + draft.bedOffsetMin * MINUTE;
  const napLo = ceilStep(Math.max(a.now, a.wakeTime + HOUR));
  const napHi = floorStep(base.bedtime - 2 * HOUR);
  const canNap = napHi - napLo >= 15 * MINUTE;
  const drinkLo = ceilStep(a.now);
  const drinkHi = floorStep(bedtime);
  const canDrink = drinkHi - drinkLo >= 15 * MINUTE;

  const live = useThrottled(draft, 100);
  const result = useMemo(() => {
    const bed = base.bedtime + live.bedOffsetMin * MINUTE;
    const scenario: Scenario = {
      bedtime: bed,
      wake: base.wake + live.wakeOffsetMin * MINUTE,
      nap: live.nap,
      caffeine: live.coffees.map((c) => ({ time: Math.min(c.time, bed), mg: c.mg })),
    };
    return simulateTomorrow(a, data, scenario);
  }, [a, data, base, live]);

  // One-tap presets; the nap and coffee ones move to "now" if 14:00 / 16:00 has passed.
  const napPresetAt = Math.max(atMinutes(a.day, 14 * 60), napLo);
  const drinkPresetAt = Math.max(atMinutes(a.day, 16 * 60), drinkLo);
  const presets: { key: string; label: string; icon: string; on: boolean; apply: () => void }[] = [];
  if (bedMinOff <= -30) {
    presets.push({ key: 'early', label: 'Bed 30 min earlier', icon: 'weather-night', on: draft.bedOffsetMin === -30, apply: () => patch({ bedOffsetMin: -30 }) });
  }
  presets.push({ key: 'late', label: 'Late night (+2h)', icon: 'party-popper', on: draft.bedOffsetMin === 120, apply: () => patch({ bedOffsetMin: 120 }) });
  if (canNap && napPresetAt <= napHi) {
    presets.push({
      key: 'nap',
      label: `Power nap at ${formatTime(napPresetAt)}`,
      icon: 'flash',
      on: draft.nap?.start === napPresetAt && draft.nap.minutes === 20,
      apply: () => patch({ nap: { start: napPresetAt, minutes: 20 } }),
    });
  }
  if (canDrink && drinkPresetAt <= drinkHi) {
    const has = draft.coffees.some((c) => c.time === drinkPresetAt);
    presets.push({
      key: 'coffee',
      label: `Coffee at ${formatTime(drinkPresetAt)}`,
      icon: 'coffee-outline',
      on: has,
      apply: () =>
        !has &&
        draft.coffees.length < MAX_COFFEES &&
        patch({ coffees: [...draft.coffees, { id: `c${Date.now()}`, time: drinkPresetAt, mg: DEFAULT_DRINK.mg, label: DEFAULT_DRINK.label }] }),
    });
  }

  const s = result.scenario;
  const b = result.baseline;
  const d = result.delta;
  const sleep = s.sleep;
  const wakeOffsetFor = (t: number) => Math.round((t - base.wake) / MINUTE / 5) * 5;
  const boundaryChoices = [sleep.boundaryWakes.earlier, sleep.boundaryWakes.later]
    .map(wakeOffsetFor)
    .filter((off) => off >= -180 && off <= 180 && off !== draft.wakeOffsetMin);
  const limitMg = data.profile.caffeineBedtimeLimitMg;
  const loggedToday = data.caffeine.filter((c) => c.time >= atMinutes(a.day, 0) && c.time <= a.now).sort((x, y) => x.time - y.time);
  const changed = draft.bedOffsetMin !== 0 || draft.wakeOffsetMin !== 0 || !!draft.nap || draft.coffees.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={styles.scroll} stickyHeaderIndices={[1]} keyboardShouldPersistTaps="handled">
        <Text style={[font.small, { marginBottom: space.sm }]}>Change tonight and watch tomorrow redraw. The dashed line is your plan.</Text>

        <View style={styles.sticky}>
          <Card style={{ marginBottom: 0, paddingBottom: space.md }}>
            <View style={[styles.row, { marginBottom: space.xs }]}>
              <Text style={[font.tiny, { flex: 1, fontWeight: '600' }]}>TOMORROW’S ENERGY</Text>
              <Text style={font.tiny}>
                wake {formatTime(s.scenario.wake)} · dip {s.tomorrow.dip ? formatTime(s.tomorrow.dip.t) : '—'}
              </Text>
            </View>
            <CompareChart
              baseline={b.tomorrow.points}
              scenario={s.tomorrow.points}
              from={result.range.from}
              to={result.range.to}
              focusEnergy={result.focusEnergy}
              dip={s.tomorrow.dip}
              height={150}
            />
            <View style={[styles.row, { marginTop: space.md }]}>
              <Kpi label="Energy" value={String(Math.round(s.tomorrow.avgEnergy))} delta={deltaNum(d.avgEnergy)} color={tone(d.avgEnergy, 'up', 0.5)} />
              <Kpi label="Debt" value={formatDuration(s.debtMin)} delta={deltaMin(d.debtMin)} color={tone(d.debtMin, 'down', 5)} />
              <Kpi label="Sleep" value={formatDuration(sleep.sleepMin)} delta={deltaMin(d.sleepMin)} color={tone(d.sleepMin, 'up', 5)} />
              <Kpi label="Score" value={String(s.score.total)} delta={deltaNum(d.score)} color={tone(d.score, 'up', 1)} />
            </View>
          </Card>
        </View>

        <View style={styles.presets}>
          {presets.map((p) => (
            <Chip key={p.key} label={p.label} icon={p.icon} selected={p.on} onPress={p.apply} />
          ))}
          {/* Always rendered so the controls below don't jump when the first change is made. */}
          <View style={{ opacity: changed ? 1 : 0.4, pointerEvents: changed ? 'auto' : 'none' }}>
            <Chip label="Reset" icon="restore" onPress={() => setDraft(NO_CHANGES)} />
          </View>
        </View>

        <Card>
          <CardTitle icon="bed-clock" title="Tonight" />
          <Slider
            label="Lights out"
            value={draft.bedOffsetMin}
            min={bedMinOff}
            max={180}
            step={5}
            fillFrom={0}
            mark={0}
            format={(v) => formatTime(base.bedtime + v * MINUTE)}
            sub={offsetLabel(draft.bedOffsetMin)}
            onChange={(v) => patch({ bedOffsetMin: v })}
          />
          <Slider
            label="Alarm"
            value={draft.wakeOffsetMin}
            min={-180}
            max={180}
            step={5}
            fillFrom={0}
            mark={0}
            color={colors.info}
            format={(v) => formatTime(base.wake + v * MINUTE)}
            sub={offsetLabel(draft.wakeOffsetMin)}
            onChange={(v) => patch({ wakeOffsetMin: v })}
          />
          <View style={styles.cycleBox}>
            <Icon name={sleep.onBoundary ? 'check-circle-outline' : 'sine-wave'} size={18} color={sleep.onBoundary ? colors.good : colors.warn} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[font.small, { color: colors.text }]}>
                {sleep.cycles.toFixed(1)} sleep cycles ·{' '}
                {sleep.onBoundary ? 'you’d wake near the end of a cycle, in light sleep' : 'the alarm would catch you mid-cycle'}
              </Text>
              <Text style={font.tiny}>
                Asleep ~{formatTime(sleep.onset)} after ~{Math.round(sleep.latencyMin)} min · {formatDuration(sleep.timeInBedMin)} in bed
              </Text>
              {!sleep.onBoundary && boundaryChoices.length ? (
                <View style={[styles.row, { gap: space.sm, marginTop: 6, flexWrap: 'wrap' }]}>
                  {boundaryChoices.map((off) => (
                    <Chip key={off} icon="alarm" label={`Wake ${formatTime(base.wake + off * MINUTE)}`} onPress={() => patch({ wakeOffsetMin: off })} />
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        </Card>

        <Card>
          <CardTitle
            icon="sleep"
            title="Nap today"
            right={
              <Switch
                value={!!draft.nap}
                disabled={!canNap}
                onValueChange={(on) => patch({ nap: on ? { start: clampT(napPresetAt, napLo, napHi), minutes: 20 } : undefined })}
                trackColor={{ true: colors.accent, false: colors.border }}
                thumbColor={colors.text}
                accessibilityLabel="Add a nap"
              />
            }
          />
          {!canNap ? (
            <Text style={font.small}>Too late for a nap today — a nap within 2 hours of bedtime mostly costs you night sleep.</Text>
          ) : draft.nap ? (
            <>
              <Slider
                label="Lie down at"
                value={clampT(draft.nap.start, napLo, napHi)}
                min={napLo}
                max={napHi}
                step={STEP}
                format={formatTime}
                onChange={(v) => patch({ nap: { ...draft.nap!, start: v } })}
              />
              <Slider
                label="Alarm after"
                value={draft.nap.minutes}
                min={10}
                max={120}
                step={5}
                format={(v) => `${v} min`}
                sub={`up ${formatTime(draft.nap.start + draft.nap.minutes * MINUTE)}`}
                onChange={(v) => patch({ nap: { ...draft.nap!, minutes: v } })}
              />
              <Text style={[font.small, { marginTop: space.xs }]}>
                ~{Math.round(s.napSleepMin)} min asleep ·{' '}
                {s.napDelayMin >= 5 ? (
                  <Text style={{ color: s.napDelayMin > 40 ? colors.warn : colors.text }}>pushes tonight’s sleepiness back ~{Math.round(s.napDelayMin)} min</Text>
                ) : (
                  <Text style={{ color: colors.good }}>barely moves your bedtime — you’re carrying enough sleep pressure</Text>
                )}
              </Text>
              {draft.nap.minutes > 30 && draft.nap.minutes < 80 ? (
                <Text style={[font.tiny, { marginTop: 4, color: colors.warn }]}>Naps of 30–75 min often end in deep sleep, so expect some grogginess.</Text>
              ) : null}
            </>
          ) : (
            <Text style={font.small}>Turn on to see what a nap does to tonight’s sleep and tomorrow.</Text>
          )}
        </Card>

        <Card>
          <CardTitle
            icon="coffee-outline"
            title="Caffeine today"
            color={colors.caffeine}
            right={
              <Button
                small
                kind="secondary"
                icon="plus"
                label="Add drink"
                disabled={!canDrink || draft.coffees.length >= MAX_COFFEES}
                onPress={() =>
                  patch({
                    coffees: [
                      ...draft.coffees,
                      { id: `c${Date.now()}`, time: clampT(ceilStep(a.now + 30 * MINUTE), drinkLo, drinkHi), mg: DEFAULT_DRINK.mg, label: DEFAULT_DRINK.label },
                    ],
                  })
                }
              />
            }
          />
          {loggedToday.length ? (
            <Text style={[font.tiny, { marginBottom: space.sm }]}>Already logged: {loggedToday.map((c) => `${formatTime(c.time)} · ${Math.round(c.mg)} mg`).join(', ')}</Text>
          ) : null}
          {draft.coffees.map((c, i) => (
            <View key={c.id} style={styles.drink}>
              <View style={styles.row}>
                <Text style={[font.tiny, { flex: 1, fontWeight: '600' }]}>
                  DRINK {i + 1} · {Math.round(c.mg)} MG
                </Text>
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove drink ${i + 1}`}
                  onPress={() => patch({ coffees: draft.coffees.filter((x) => x.id !== c.id) })}
                >
                  <Icon name="close" size={18} />
                </Pressable>
              </View>
              <Slider
                label="Time"
                value={clampT(c.time, drinkLo, drinkHi)}
                min={drinkLo}
                max={Math.max(drinkLo, drinkHi)}
                step={STEP}
                format={formatTime}
                color={colors.caffeine}
                onChange={(v) => patch({ coffees: draft.coffees.map((x) => (x.id === c.id ? { ...x, time: v } : x)) })}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}>
                {CAFFEINE_PRESETS.map((p) => (
                  <Chip
                    key={p.label}
                    label={`${shortLabel(p.label)} · ${p.mg}`}
                    selected={c.label === p.label}
                    color={colors.caffeine}
                    onPress={() => patch({ coffees: draft.coffees.map((x) => (x.id === c.id ? { ...x, mg: p.mg, label: p.label } : x)) })}
                  />
                ))}
              </ScrollView>
            </View>
          ))}
          {!canDrink ? <Text style={font.small}>It’s nearly bedtime — anything now is still in you while you sleep.</Text> : null}
          <Text style={[font.small, { marginTop: draft.coffees.length ? space.sm : 0 }]}>
            Caffeine in your first 3 h of sleep:{' '}
            <Text style={{ color: s.caffeineMg > limitMg ? colors.warn : colors.text, fontWeight: '600' }}>{Math.round(s.caffeineMg)} mg</Text> (your limit {limitMg} mg)
          </Text>
        </Card>

        <Card>
          <CardTitle icon="compare-horizontal" title="Compared with your plan" />
          <View style={[styles.tableRow, { paddingTop: 0 }]}>
            <Text style={[font.tiny, { flex: 1.5 }]} />
            <Text style={[font.tiny, styles.cell]}>PLAN</Text>
            <Text style={[font.tiny, styles.cell]}>WHAT IF</Text>
            <View style={styles.deltaCell} />
          </View>
          <Group title="Tonight" />
          <TableRow label="Sleep" plan={formatDuration(b.sleep.sleepMin)} what={formatDuration(sleep.sleepMin)} delta={deltaMin(d.sleepMin)} color={tone(d.sleepMin, 'up', 5)} />
          <TableRow label="Falling asleep" plan={`${Math.round(b.sleep.latencyMin)} min`} what={`${Math.round(sleep.latencyMin)} min`} delta={deltaMin(d.latencyMin)} color={tone(d.latencyMin, 'down', 3)} />
          <TableRow
            label="Sleep cycles"
            plan={`${b.sleep.cycles.toFixed(1)}${b.sleep.onBoundary ? ' ✓' : ''}`}
            what={`${sleep.cycles.toFixed(1)}${sleep.onBoundary ? ' ✓' : ''}`}
            delta={sleep.onBoundary === b.sleep.onBoundary ? deltaNum(d.cycles, 1) : sleep.onBoundary ? 'on cycle' : 'mid-cycle'}
            color={sleep.onBoundary === b.sleep.onBoundary ? colors.textFaint : sleep.onBoundary ? colors.good : colors.warn}
          />
          <TableRow label="Bedtime caffeine" plan={`${Math.round(b.caffeineMg)} mg`} what={`${Math.round(s.caffeineMg)} mg`} delta={deltaNum(d.caffeineMg, 0, ' mg')} color={tone(d.caffeineMg, 'down', 3)} />
          <TableRow label="Nap delay" plan="—" what={s.napSleepMin ? `${Math.round(s.napDelayMin)} min` : '—'} delta={deltaMin(d.napDelayMin)} color={tone(d.napDelayMin, 'down', 5)} />
          <TableRow label="Expected score" plan={String(b.score.total)} what={String(s.score.total)} delta={deltaNum(d.score)} color={tone(d.score, 'up', 1)} />
          <Group title="Tomorrow" />
          <TableRow label="Sleep debt" plan={formatDuration(b.debtMin)} what={formatDuration(s.debtMin)} delta={deltaMin(d.debtMin)} color={tone(d.debtMin, 'down', 5)} />
          <TableRow label="Average energy" plan={String(Math.round(b.tomorrow.avgEnergy))} what={String(Math.round(s.tomorrow.avgEnergy))} delta={deltaNum(d.avgEnergy)} color={tone(d.avgEnergy, 'up', 0.5)} />
          <TableRow label="Focus zone" plan={`${b.tomorrow.focusHours.toFixed(1)} h`} what={`${s.tomorrow.focusHours.toFixed(1)} h`} delta={deltaNum(d.focusHours, 1, 'h')} color={tone(d.focusHours, 'up', 0.25)} />
          <TableRow
            label="Afternoon dip"
            plan={b.tomorrow.dip ? `${formatTime(b.tomorrow.dip.t)} · ${Math.round(b.tomorrow.dip.energy)}` : '—'}
            what={s.tomorrow.dip ? `${formatTime(s.tomorrow.dip.t)} · ${Math.round(s.tomorrow.dip.energy)}` : '—'}
            delta={b.tomorrow.dip && s.tomorrow.dip ? deltaNum(s.tomorrow.dip.energy - b.tomorrow.dip.energy) : undefined}
            color={b.tomorrow.dip && s.tomorrow.dip ? tone(s.tomorrow.dip.energy - b.tomorrow.dip.energy, 'up', 0.5) : undefined}
          />
        </Card>

        <ModelNotes a={a} result={result} />
      </ScrollView>
    </View>
  );
}

function Kpi({ label, value, delta, color }: { label: string; value: string; delta: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={font.tiny}>{label.toUpperCase()}</Text>
      <Text style={[font.h3, { marginTop: 2, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
        {value}
      </Text>
      <View style={[styles.pill, { borderColor: color }]}>
        <Text style={{ color, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {delta}
        </Text>
      </View>
    </View>
  );
}

function Group({ title }: { title: string }) {
  return <Text style={[font.tiny, { marginTop: space.sm, marginBottom: 2, color: colors.accent, fontWeight: '600' }]}>{title.toUpperCase()}</Text>;
}

function TableRow({ label, plan, what, delta, color = colors.textFaint }: { label: string; plan: string; what: string; delta?: string; color?: string }) {
  return (
    <View style={styles.tableRow}>
      <Text style={[font.small, { flex: 1.5, color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[font.small, styles.cell]} numberOfLines={1}>
        {plan}
      </Text>
      <Text style={[font.small, styles.cell, { color: colors.text, fontWeight: '600' }]} numberOfLines={1}>
        {what}
      </Text>
      <View style={styles.deltaCell}>{delta ? <Text style={{ color, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{delta}</Text> : null}</View>
    </View>
  );
}

function ModelNotes({ a, result }: { a: Analysis; result: SimulationResult }) {
  const notes: ReactNode[] = [
    `Tonight’s sleep is your time in bed minus the ~${Math.round(a.latencyMin)} min you usually take to fall asleep, times your sleep efficiency (${Math.round(a.efficiency * 100)}%). Sleep cycles use your measured ${Math.round(a.cycleMin)}-min cycle; an alarm within ${SIM.boundaryToleranceMin} min of a cycle boundary finds you in light sleep.`,
    'A nap lowers sleep pressure (two-process model), so you get sleepy later and take longer to fall asleep. Caffeine above ~20 mg in your first hours of sleep adds a little time awake and costs some deep sleep. Lights-out more than an hour before your usual sleep onset falls in the evening “wake-maintenance zone”, where about half the extra time is spent lying awake.',
    'Tomorrow’s debt is your 14-night weighted sleep debt with this night (and nap) added. Energy uses the same three-process model as Today — sleep pressure, body clock and sleep inertia, minus a penalty for debt.',
    `Focus zone is time within ${SIM.focusBelowPeak} points of your planned day’s peak (energy ${result.focusEnergy}+). The expected score rates a synthetic night shaped like yours — cycle length, deep and REM share, awakenings — the same way real nights are scored.`,
    'It’s a model, not a promise: single nights vary a lot. Use it to compare options, not to predict to the minute.',
  ];
  return (
    <Card>
      <CardTitle icon="flask-outline" title="How the simulator works" />
      <View style={{ gap: space.sm }}>
        {notes.map((n, i) => (
          <Text key={i} style={font.small}>
            {n}
          </Text>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: 48 },
  sticky: { backgroundColor: colors.bg, paddingBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  cycleBox: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
  },
  drink: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.sm, marginBottom: space.sm },
  pill: { marginTop: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: space.xs },
  cell: { flex: 1, textAlign: 'right' },
  deltaCell: { width: 62, alignItems: 'flex-end' },
});
