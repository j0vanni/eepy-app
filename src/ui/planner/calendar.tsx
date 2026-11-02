/**
 * The month calendar: past nights (sleep vs your need, score) and coming mornings (planned
 * wake-ups), with a detail card for the tapped day. Used by the "Month view" screen (from the
 * Planner) and the Sleep tab's Calendar view.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Analysis, trendRows, TrendRow } from '@/engine/analysis';
import { mean } from '@/engine/stats';
import { TAG_BY_ID } from '@/engine/tags';
import { addDays, circularMeanMinutes, dateKey, formatClock, formatDuration, formatTime, normalizeMinutes, startOfDateKey, weekdayOfKey } from '@/engine/time';
import type { DayWakePlan } from '@/engine/types';
import type { UpcomingNight } from '@/engine/weekPlan';
import { selectDataset, useStore } from '@/state/store';
import { Button, Card, CardTitle, Chip, Icon, Row, Stat } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, radius, space } from '@/ui/theme';

import { NightBeforeStats, PLAN_AHEAD_DAYS, WakePlanPicker } from './DayPlan';
import { compactTime, DAY_NAMES } from './planText';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Month = { y: number; m: number };
const monthOf = (key: string): Month => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1 });
const keyOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const shortDuration = (min: number) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;

/** Weeks (Sunday first) covering the month, with blanks before the 1st and after the last day. */
function monthGrid({ y, m }: Month): (string | undefined)[][] {
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | undefined)[] = [...Array(first).fill(undefined), ...Array.from({ length: days }, (_, i) => keyOf(y, m, i + 1))];
  while (cells.length % 7) cells.push(undefined);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

export function CalendarView({ a, initialDate }: { a: Analysis; initialDate?: string }) {
  const data = useStore(useShallow(selectDataset));
  const wakePlan = useStore((s) => s.profile.wakePlan);
  const today = dateKey(Date.now());
  const [selected, setSelected] = useState(initialDate ?? a.tonight.wakeDate ?? today);
  const [month, setMonth] = useState<Month>(() => monthOf(initialDate ?? today));

  const rows = useMemo(() => trendRows(a, data, 120), [a, data]);
  const byDate = useMemo(() => new Map(rows.filter((r) => r.sleepMin !== undefined).map((r) => [r.date, r])), [rows]);
  const upcoming = useMemo(() => new Map(a.upcoming.map((n) => [n.wakeDate, n])), [a]);

  const need = a.need.needMin;
  const monthRows = rows.filter((r) => r.sleepMin !== undefined && monthOf(r.date).y === month.y && monthOf(r.date).m === month.m);
  const shift = (d: number) => setMonth(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));
  const firstPlanned = a.tonight.wakeDate;

  return (
    <>
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
                planned={key ? setsWake(wakePlan?.[key]) : undefined}
                need={need}
                today={key === today}
                selected={key === selected}
                onPress={() => key && setSelected(key)}
              />
            ))}
          </View>
        ))}
        <Row gap={space.md} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
          <Legend color={colors.accent} label="slept enough" />
          <Legend color={colors.warn} label="short" />
          <Legend icon="alarm" label="planned wake-up" />
          <Legend icon="weather-sunny" label="free day" />
        </Row>
        <Text style={[font.tiny, { marginTop: 6 }]}>Each day shows the night that ended that morning. Tap a day to see it, or a coming day to plan its wake-up.</Text>
      </Card>

      <DayDetail
        a={a}
        date={selected}
        row={byDate.get(selected)}
        night={upcoming.get(selected)}
        tags={data.dayLogs[addDays(selected, -1)]?.tags ?? []}
        isPast={selected < firstPlanned}
        isTonight={selected === firstPlanned}
        canPlan={selected >= firstPlanned && selected <= addDays(today, PLAN_AHEAD_DAYS)}
      />
    </>
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

/** A date's plan when it sets the wake-up (a time or a free day) — a routine-only choice doesn't mark the day. */
function setsWake(p: DayWakePlan | undefined): DayWakePlan | undefined {
  return p && (p.free || p.wakeMin !== undefined) ? p : undefined;
}

function DayCell(props: { date?: string; row?: TrendRow; night?: UpcomingNight; planned?: DayWakePlan; need: number; today: boolean; selected: boolean; onPress: () => void }) {
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
          <Text style={[styles.cellText, { color: planned ? colors.accent : colors.textDim }]}>{night.noAlarm ? 'free' : compactTime(night.wake)}</Text>
        </>
      ) : planned ? (
        <>
          <Icon name={planned.free ? 'weather-sunny' : 'alarm'} size={11} color={planned.free ? colors.energy : colors.accent} />
          <Text style={[styles.cellText, { color: colors.accent }]}>{planned.free ? 'free' : planned.wakeMin !== undefined ? compactTime(startOfDateKey(date) + planned.wakeMin * 60_000) : ''}</Text>
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
        <Stat label="Enough sleep" value={`${met}/${rows.length}`} sub="nights" />
      </Row>
      {onset !== undefined && wake !== undefined ? (
        <Text style={[font.small, { marginTop: space.sm }]}>
          Usually asleep around {formatClock(normalizeMinutes(onset))} and up around {formatClock(normalizeMinutes(wake))} this month.
        </Text>
      ) : null}
    </Card>
  );
}

function DayDetail(props: { a: Analysis; date: string; row?: TrendRow; night?: UpcomingNight; tags: string[]; isPast: boolean; isTonight: boolean; canPlan: boolean }) {
  const { a, date, row, night, tags } = props;
  const need = a.need.needMin;
  const title = `${dayLabel(date)}${dayLabel(date).includes(' ') ? '' : `, ${DAY_NAMES[weekdayOfKey(date)]}`}`;
  const sessionId = a.nights.find((n) => n.wakeDate === date)?.main?.id;

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
          <Stat label="Sleep" value={formatDuration(main)} sub={main >= need - 15 ? 'enough sleep' : `${formatDuration(need - main)} short`} color={main >= need - 15 ? undefined : colors.warn} />
          <Stat label="Deep · REM" value={row.deepPct !== undefined && row.remPct !== undefined ? `${Math.round(row.deepPct * 100)}·${Math.round(row.remPct * 100)}%` : '–'} />
          <Stat label="Sleep debt" value={formatDuration(row.debtMin)} sub="that morning" />
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

  return (
    <Card accent={colors.accent}>
      <CardTitle icon="calendar-edit" title={`${title}${props.isTonight ? ' (tonight)' : ''}`} />
      {props.canPlan ? (
        <>
          <Text style={[font.small, { marginBottom: 6 }]}>Wake-up that morning</Text>
          <WakePlanPicker date={date} />
        </>
      ) : null}
      {night ? (
        <NightBeforeStats night={night} needMin={need} isTonight={props.isTonight} />
      ) : props.canPlan ? (
        <Text style={[font.small, { marginTop: space.md }]}>The best bedtime for this morning appears two weeks ahead.</Text>
      ) : null}
    </Card>
  );
}

/** "Tonight", "Tomorrow night", "Wed 4 Nov night" for the night before a morning. */
function nightName(wakeDate: string): string {
  const d = dayLabel(addDays(wakeDate, -1));
  return d === 'Today' ? 'Tonight' : `${d} night`;
}

/** Recovery autopilot: how the coming nights pay back sleep debt, a little each night. */
export function RecoveryCard({ nights, debtMin }: { nights: UpcomingNight[]; debtMin: number }) {
  if (debtMin < 60) return null;
  const paying = nights.filter((n) => n.extraForDebtMin > 0).slice(0, 4);
  const clear = nights.find((n) => n.debtAfterMin < 60);
  return (
    <Card accent={colors.warn}>
      <CardTitle icon="battery-charging-medium" title="Getting back on track" color={colors.warn} />
      <Text style={font.small}>
        You're {formatDuration(debtMin)} short on sleep (sleep debt). Instead of one long lie-in, eepy adds a little to the next nights (at most 30 min each) and keeps your
        wake-ups steady.
      </Text>
      <View style={{ marginTop: space.sm, gap: 4 }}>
        {paying.map((n) => (
          <Row key={n.wakeDate}>
            <Text style={[font.small, { flex: 1, color: colors.text }]}>{nightName(n.wakeDate)}</Text>
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
});
