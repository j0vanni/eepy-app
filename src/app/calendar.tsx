import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { trendRows, TrendRow } from '@/engine/analysis';
import { wakeTargetFor } from '@/engine/schedule';
import { mean } from '@/engine/stats';
import { TAG_BY_ID } from '@/engine/tags';
import { addDays, circularMeanMinutes, dateKey, formatClock, formatDuration, formatTime, getClockFormat, normalizeMinutes, startOfDateKey, weekdayOfKey } from '@/engine/time';
import type { DayWakePlan } from '@/engine/types';
import type { UpcomingNight } from '@/engine/weekPlan';
import { selectDataset, useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Empty, Icon, Note, Row, Screen, Segmented, Stat, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, radius, space } from '@/ui/theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** How far ahead mornings can be planned. */
const PLAN_AHEAD_DAYS = 90;

type Month = { y: number; m: number };
const monthOf = (key: string): Month => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 });
const keyOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** "6:30a" / "06:30" for the small calendar cells. */
function cellTime(t: number): string {
  const s = formatTime(t);
  return getClockFormat() === '12h' ? s.replace(/ (AM|PM)$/, (_, p: string) => p[0].toLowerCase()) : s;
}
const shortDuration = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;

/** Weeks (Sunday first) covering the month, with blanks before the 1st and after the last day. */
function monthGrid({ y, m }: Month): (string | undefined)[][] {
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | undefined)[] = [...Array(first).fill(undefined), ...Array.from({ length: days }, (_, i) => keyOf(y, m, i + 1))];
  while (cells.length % 7) cells.push(undefined);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Calendar of past nights (sleep vs need, score) and coming mornings (planned wake-ups), with a per-day planner. */
export default function CalendarScreen() {
  const a = useAnalysis();
  const data = useStore(useShallow(selectDataset));
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const params = useLocalSearchParams<{ date?: string }>();
  const today = dateKey(Date.now());
  const [selected, setSelected] = useState(params.date ?? a?.tonight.wakeDate ?? today);
  const [month, setMonth] = useState<Month>(() => monthOf(params.date ?? today));

  const rows = useMemo(() => (a ? trendRows(a, data, 120) : []), [a, data]);
  const byDate = useMemo(() => new Map(rows.filter((r) => r.sleepMin !== undefined).map((r) => [r.date, r])), [rows]);
  const upcoming = useMemo(() => new Map((a?.upcoming ?? []).map((n) => [n.wakeDate, n])), [a]);

  if (!a) {
    return (
      <Screen>
        <Empty icon="calendar-month" title="No nights yet" body="Your calendar fills in as nights arrive from your watch. You can already plan mornings in Settings." />
      </Screen>
    );
  }

  const need = a.need.needMin;
  const setPlan = (date: string, plan: DayWakePlan | undefined) => {
    const next: Record<string, DayWakePlan> = { ...(profile.wakePlan ?? {}) };
    if (plan) next[date] = plan;
    else delete next[date];
    // Old mornings are history; keep the store small.
    for (const k of Object.keys(next)) if (k < addDays(today, -30)) delete next[k];
    setProfile({ wakePlan: next });
  };

  const monthRows = rows.filter((r) => r.sleepMin !== undefined && monthOf(r.date).y === month.y && monthOf(r.date).m === month.m);
  const shift = (d: number) => setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const firstPlanned = a.tonight.wakeDate;

  return (
    <Screen subtitle="Each day shows the night that ends that morning. Tap a coming day to plan its wake-up.">
      <MonthStats rows={monthRows} need={need} />

      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
          <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityLabel="Previous month">
            <Icon name="chevron-left" size={26} color={colors.text} />
          </Pressable>
          <Text style={font.h3}>
            {MONTHS[month.m]} {month.y}
          </Text>
          <Pressable onPress={() => shift(1)} hitSlop={10} accessibilityLabel="Next month">
            <Icon name="chevron-right" size={26} color={colors.text} />
          </Pressable>
        </Row>
        <View style={styles.week}>
          {WEEKDAYS.map((d, i) => (
            <Text key={i} style={[font.tiny, styles.weekday]}>
              {d}
            </Text>
          ))}
        </View>
        {monthGrid(month).map((week, w) => (
          <View key={w} style={styles.week}>
            {week.map((key, i) => (
              <DayCell
                key={key ?? `b${w}-${i}`}
                date={key}
                row={key ? byDate.get(key) : undefined}
                night={key ? upcoming.get(key) : undefined}
                planned={key ? profile.wakePlan?.[key] : undefined}
                need={need}
                today={key === today}
                selected={key === selected}
                onPress={() => key && setSelected(key)}
              />
            ))}
          </View>
        ))}
        <Row gap={space.md} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
          <Legend color={colors.accent} label="met your need" />
          <Legend color={colors.warn} label="short" />
          <Legend icon="alarm" label="planned wake-up" />
          <Legend icon="weather-sunny" label="free day" />
        </Row>
      </Card>

      <DayDetail
        date={selected}
        row={byDate.get(selected)}
        night={upcoming.get(selected)}
        sessionId={a.nights.find((n) => n.wakeDate === selected)?.main?.id}
        tags={data.dayLogs[addDays(selected, -1)]?.tags ?? []}
        need={need}
        isPast={selected < firstPlanned}
        isTonight={selected === firstPlanned}
        canPlan={selected >= firstPlanned && selected <= addDays(today, PLAN_AHEAD_DAYS)}
        plan={profile.wakePlan?.[selected]}
        usual={wakeTargetFor({ ...profile, wakePlan: undefined }, selected)}
        onPlan={(p) => setPlan(selected, p)}
      />

      <RecoveryCard nights={a.upcoming} debtMin={a.debt.debtMin} />

      <Card>
        <CardTitle icon="calendar-arrow-right" title="Next 7 nights" />
        {a.upcoming.slice(0, 7).map((n) => (
          <Pressable
            key={n.wakeDate}
            onPress={() => {
              setSelected(n.wakeDate);
              setMonth(monthOf(n.wakeDate));
            }}
            style={({ pressed }) => [styles.agenda, pressed ? { opacity: 0.6 } : null]}
          >
            <Text style={[font.small, { width: 86, color: colors.text }]}>{n.wakeDate === firstPlanned ? 'Tonight' : `${DAY_NAMES[weekdayOfKey(addDays(n.wakeDate, -1))].slice(0, 3)} night`}</Text>
            <Text style={[font.small, { flex: 1, fontVariant: ['tabular-nums'] }]}>
              {formatTime(n.bedtime)} → {formatTime(n.wake)}
            </Text>
            <Text style={[font.small, { width: 52, textAlign: 'right' }]}>{formatDuration(n.sleepMin)}</Text>
            <View style={{ width: 22, alignItems: 'flex-end' }}>
              {n.noAlarm ? <Icon name="weather-sunny" size={16} color={colors.energy} /> : n.custom ? <Icon name="alarm" size={16} color={colors.accent} /> : null}
            </View>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

function Legend({ color, icon, label }: { color?: string; icon?: string; label: string }) {
  return (
    <Row gap={4}>
      {icon ? <Icon name={icon} size={12} color={icon === 'weather-sunny' ? colors.energy : colors.accent} /> : <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: color }} />}
      <Text style={font.tiny}>{label}</Text>
    </Row>
  );
}

function DayCell(props: {
  date?: string;
  row?: TrendRow;
  night?: UpcomingNight;
  planned?: DayWakePlan;
  need: number;
  today: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const { date, row, night, planned, need, today, selected } = props;
  if (!date) return <View style={styles.cell} />;
  const main = row?.sleepMin !== undefined ? row.sleepMin - row.napMin : undefined;
  const met = main !== undefined && main >= need - 15;
  return (
    <Pressable
      onPress={props.onPress}
      style={[styles.cell, selected ? { backgroundColor: colors.accentSoft } : null, today ? { borderColor: colors.accent, borderWidth: 1 } : null]}
      accessibilityRole="button"
      accessibilityLabel={`${dayLabel(date)}${main !== undefined ? `, slept ${formatDuration(main)}` : ''}${night ? `, wake ${formatTime(night.wake)}` : ''}`}
    >
      <Text style={[font.tiny, { color: selected || today ? colors.text : colors.textDim, fontWeight: today ? '700' : '500' }]}>{Number(date.slice(8))}</Text>
      {main !== undefined ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { width: `${Math.min(100, (main / need) * 100)}%`, backgroundColor: met ? colors.accent : colors.warn }]} />
          </View>
          <Text style={[styles.cellText, { color: met ? colors.text : colors.warn }]}>{shortDuration(main)}</Text>
        </>
      ) : night ? (
        <>
          <Icon name={night.noAlarm ? 'weather-sunny' : 'alarm'} size={11} color={night.noAlarm ? colors.energy : planned ? colors.accent : colors.textFaint} />
          <Text style={[styles.cellText, { color: planned ? colors.accent : colors.textDim }]}>{night.noAlarm ? 'free' : cellTime(night.wake)}</Text>
        </>
      ) : planned ? (
        <>
          <Icon name={planned.free ? 'weather-sunny' : 'alarm'} size={11} color={planned.free ? colors.energy : colors.accent} />
          <Text style={[styles.cellText, { color: colors.accent }]}>{planned.free ? 'free' : planned.wakeMin !== undefined ? cellTime(startOfDateKey(date) + planned.wakeMin * 60_000) : ''}</Text>
        </>
      ) : null}
    </Pressable>
  );
}

function MonthStats({ rows, need }: { rows: TrendRow[]; need: number }) {
  if (!rows.length) return null;
  const sleep = rows.map((r) => r.sleepMin! - r.napMin);
  const scores = rows.map((r) => r.score).filter((v): v is number => v !== undefined);
  const met = sleep.filter((s) => s >= need - 15).length;
  const onset = circularMeanMinutes(rows.map((r) => r.onsetMin).filter((v): v is number => v !== undefined));
  const wake = circularMeanMinutes(rows.map((r) => r.wakeMin).filter((v): v is number => v !== undefined));
  return (
    <Card>
      <Row>
        <Stat label="Avg sleep" value={formatDuration(mean(sleep))} sub={`need ${formatDuration(need)}`} />
        <Stat label="Avg score" value={scores.length ? String(Math.round(mean(scores))) : '–'} />
        <Stat label="Nights met" value={`${met}/${rows.length}`} />
      </Row>
      {onset !== undefined && wake !== undefined ? (
        <Text style={[font.small, { marginTop: space.sm }]}>
          Usually asleep around {formatClock(normalizeMinutes(onset))} and up around {formatClock(normalizeMinutes(wake))} this month.
        </Text>
      ) : null}
    </Card>
  );
}

function DayDetail(props: {
  date: string;
  row?: TrendRow;
  night?: UpcomingNight;
  sessionId?: string;
  tags: string[];
  need: number;
  isPast: boolean;
  isTonight: boolean;
  canPlan: boolean;
  plan?: DayWakePlan;
  usual: { wakeMin: number; isWorkday: boolean };
  onPlan: (p: DayWakePlan | undefined) => void;
}) {
  const { date, row, night, sessionId, tags, need, plan, usual } = props;
  const title = `${dayLabel(date)}${dayLabel(date).includes(' ') ? '' : `, ${DAY_NAMES[weekdayOfKey(date)]}`}`;

  if (props.isPast || (row && !night)) {
    if (!row) {
      return (
        <Card>
          <CardTitle icon="bed-outline" title={title} />
          <Text style={font.small}>No sleep recorded for the night ending this morning.</Text>
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="pencil-plus" label="Log it" onPress={() => router.push({ pathname: '/log-sleep', params: { date } })} />
          </View>
        </Card>
      );
    }
    const main = row.sleepMin! - row.napMin;
    return (
      <Card>
        <CardTitle icon="bed-outline" title={title} right={row.score !== undefined ? <Text style={font.h3}>{row.score}</Text> : undefined} />
        {row.onsetMin !== undefined && row.wakeMin !== undefined ? (
          <Text style={font.body}>
            Asleep {formatClock(row.onsetMin)} → up {formatClock(row.wakeMin)}
          </Text>
        ) : null}
        <Row style={{ marginTop: space.sm }}>
          <Stat label="Sleep" value={formatDuration(main)} sub={main >= need - 15 ? 'met your need' : `${formatDuration(need - main)} short`} color={main >= need - 15 ? undefined : colors.warn} />
          <Stat label="Deep · REM" value={row.deepPct !== undefined && row.remPct !== undefined ? `${Math.round(row.deepPct * 100)}·${Math.round(row.remPct * 100)}%` : '–'} />
          <Stat label="Debt that morning" value={formatDuration(row.debtMin)} />
        </Row>
        {row.napMin > 0 ? <Text style={[font.small, { marginTop: space.sm }]}>Plus {formatDuration(row.napMin)} of naps that day.</Text> : null}
        {tags.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm }}>
            {tags.map((t) => (TAG_BY_ID[t] ? <Chip key={t} icon={TAG_BY_ID[t].icon} label={TAG_BY_ID[t].label} /> : null))}
          </View>
        ) : null}
        {sessionId ? (
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="secondary" icon="chart-timeline-variant" label="Night details" onPress={() => router.push({ pathname: '/night/[id]', params: { id: sessionId } })} />
          </View>
        ) : null}
      </Card>
    );
  }

  const mode: 'usual' | 'custom' | 'free' = plan?.free ? 'free' : plan?.wakeMin !== undefined ? 'custom' : 'usual';
  const customMin = plan?.wakeMin ?? usual.wakeMin;
  return (
    <Card accent={colors.accent}>
      <CardTitle icon="calendar-edit" title={`${title}${props.isTonight ? ' (tonight)' : ''}`} />
      {props.canPlan ? (
        <>
          <Text style={[font.small, { marginBottom: 6 }]}>Wake-up that morning</Text>
          <Segmented
            value={mode}
            onChange={(m) => props.onPlan(m === 'usual' ? undefined : m === 'free' ? { free: true } : { wakeMin: customMin })}
            options={[
              { label: `Usual · ${formatClock(usual.wakeMin)}`, value: 'usual' },
              { label: 'Set time', value: 'custom' },
              { label: 'Free day', value: 'free' },
            ]}
          />
          {mode === 'custom' ? (
            <Stepper
              label="Up by"
              sub="Need to be up at a set time (work, a flight, an appointment)"
              value={formatClock(customMin)}
              onDec={() => props.onPlan({ wakeMin: normalizeMinutes(customMin - 15) })}
              onInc={() => props.onPlan({ wakeMin: normalizeMinutes(customMin + 15) })}
            />
          ) : null}
          {mode === 'free' ? <Text style={[font.small, { marginTop: space.sm }]}>No alarm that morning — sleep in, up to about {formatClock(usual.isWorkday ? usual.wakeMin + 60 : usual.wakeMin)}.</Text> : null}
        </>
      ) : null}

      {night ? (
        <View style={{ marginTop: space.md }}>
          <Text style={font.tiny}>OPTIMAL NIGHT BEFORE</Text>
          <Row style={{ marginTop: 4 }}>
            <Stat label="Wind down" value={formatTime(night.windDownStart)} />
            <Stat label="Lights out" value={formatTime(night.bedtime)} color={colors.accent} />
            <Stat label={night.noAlarm ? 'Wake (free)' : 'Alarm'} value={night.alarm ? formatTime(night.alarm) : formatTime(night.wake)} sub={night.noAlarm ? 'no alarm' : night.cycles ? `${night.cycles} cycles` : undefined} />
          </Row>
          <Text style={[font.small, { marginTop: space.sm }]}>
            Expected sleep {formatDuration(night.sleepMin)} (need {formatDuration(need)}){night.extraForDebtMin > 0 ? ` · +${night.extraForDebtMin} min toward sleep debt` : ''}.
          </Text>
          {night.heldBack && night.sleepMin < need - 30 ? (
            <Note tone="warn" icon="clock-alert-outline">
              {`Lights-out can't move much earlier than your body clock allows — you'd mostly lie awake — so this night runs ${formatDuration(need - night.sleepMin)} short. A short nap that afternoon helps; eepy eases the nights before where it can.`}
            </Note>
          ) : null}
          {night.preShiftMin > 0 && night.preShiftFor ? (
            <Note icon="arrow-collapse-left">
              {`${formatDuration(night.preShiftMin)} earlier than usual to ease into ${DAY_NAMES[weekdayOfKey(night.preShiftFor)]}'s early start — the body clock only moves earlier gradually.`}
            </Note>
          ) : null}
          {props.isTonight ? (
            <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
              <Button small kind="secondary" icon="clock-edit-outline" label="Can't make it? Adjust tonight" onPress={() => router.push('/tonight')} />
            </View>
          ) : null}
        </View>
      ) : props.canPlan ? (
        <Text style={[font.small, { marginTop: space.md }]}>The optimal bedtime for this morning appears two weeks ahead.</Text>
      ) : null}
    </Card>
  );
}

/** Recovery autopilot: how the coming nights pay back sleep debt, a little each night. */
function RecoveryCard({ nights, debtMin }: { nights: UpcomingNight[]; debtMin: number }) {
  if (debtMin < 60) return null;
  const paying = nights.filter((n) => n.extraForDebtMin > 0).slice(0, 4);
  const clear = nights.find((n) => n.debtAfterMin < 60);
  return (
    <Card accent={colors.warn}>
      <CardTitle icon="battery-charging-medium" title="Getting back on track" color={colors.warn} />
      <Text style={font.small}>
        {formatDuration(debtMin)} of sleep debt. Rather than one long lie-in, eepy adds a little to the next nights (at most 30 min each) and keeps your wake-ups steady.
      </Text>
      <View style={{ marginTop: space.sm, gap: 4 }}>
        {paying.map((n) => (
          <Row key={n.wakeDate}>
            <Text style={[font.small, { flex: 1, color: colors.text }]}>{dayLabel(addDays(n.wakeDate, -1))} night</Text>
            <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>
              lights out {formatTime(n.bedtime)} · +{n.extraForDebtMin} min
            </Text>
          </Row>
        ))}
      </View>
      <Text style={[font.small, { marginTop: space.sm }]}>
        {clear ? `Under 1 h by ${dayLabel(clear.wakeDate).toLowerCase()} morning if you follow the plan.` : 'Keeps shrinking over the next two weeks if you follow the plan.'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', marginBottom: 4 },
  cell: { flex: 1, height: 58, margin: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 4, gap: 2, borderWidth: 1, borderColor: 'transparent' },
  cellText: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { width: '70%', height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginTop: 2 },
  bar: { height: 4, borderRadius: 2 },
  agenda: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
});
