/**
 * The month: how you slept (the average as the big number), a grid of past nights and coming
 * mornings, and the tapped day under it — a past night's numbers, or a coming morning's wake-up
 * choice and the night before. Used by the month view (from the Plan tab) and the Sleep tab.
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
import { Button, Card, Chip, Hero, Icon, IconButton, Row, Section, Stat } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, radius, scoreColor, space } from '@/ui/theme';

import { NightBeforeStats, PLAN_AHEAD_DAYS, WakePlanPicker } from './DayPlan';
import { Caption } from './parts';
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
      <MonthHero month={month} rows={monthRows} need={need} onShift={shift} />

      <Card style={{ padding: space.sm }}>
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
      </Card>
      <Row gap={space.md} style={{ flexWrap: 'wrap', rowGap: space.xs, paddingHorizontal: space.xs }}>
        <Legend color={colors.sleep} label="slept enough" />
        <Legend color={colors.warn} label="short" />
        <Legend icon="alarm" label="wake-up" />
        <Legend icon="weather-sunny" label="free day" />
      </Row>
      <Text style={[font.tiny, { marginTop: space.xs, paddingHorizontal: space.xs }]}>A day shows the night that ended that morning. Tap a coming day to plan its wake-up.</Text>

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
    <Row gap={space.xs}>
      {icon ? <Icon name={icon} size={12} color={icon === 'weather-sunny' ? colors.energy : colors.textDim} /> : <View style={[styles.swatch, { backgroundColor: color }]} />}
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
      style={({ pressed }) => [styles.cell, selected ? { backgroundColor: colors.accentSoft } : null, pressed ? { opacity: 0.7 } : null]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${dayLabel(date)}${main !== undefined ? `, slept ${formatDuration(main)}` : ''}${night ? `, wake ${formatTime(night.wake)}` : ''}`}
    >
      <Text style={[font.tiny, { color: today ? colors.accent : selected ? colors.text : colors.textDim, fontWeight: today ? '800' : '500' }]}>{Number(date.slice(8))}</Text>
      {main !== undefined ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { width: `${Math.min(100, (main / need) * 100)}%`, backgroundColor: met ? colors.sleep : colors.warn }]} />
          </View>
          <Text style={[styles.cellText, { color: met ? colors.text : colors.warn }]} numberOfLines={1}>{shortDuration(main)}</Text>
        </>
      ) : night ? (
        <>
          <Icon name={night.noAlarm ? 'weather-sunny' : 'alarm'} size={11} color={night.noAlarm ? colors.energy : planned ? colors.accent : colors.textFaint} />
          <Text style={[styles.cellText, { color: planned ? colors.accent : colors.textDim }]} numberOfLines={1}>{night.noAlarm ? 'free' : compactTime(night.wake)}</Text>
        </>
      ) : planned ? (
        <>
          <Icon name={planned.free ? 'weather-sunny' : 'alarm'} size={11} color={planned.free ? colors.energy : colors.accent} />
          <Text style={[styles.cellText, { color: colors.accent }]} numberOfLines={1}>{planned.free ? 'free' : planned.wakeMin !== undefined ? compactTime(startOfDateKey(date) + planned.wakeMin * 60_000) : ''}</Text>
        </>
      ) : null}
    </Pressable>
  );
}

/** The month in one number: average sleep, with the arrows that change the month. */
function MonthHero({ month, rows, need, onShift }: { month: Month; rows: TrendRow[]; need: number; onShift: (d: number) => void }) {
  const sleep = rows.map((r) => r.sleepMin! - r.napMin);
  const scores = rows.map((r) => r.score).filter((v): v is number => v !== undefined);
  const met = sleep.filter((s) => s >= need - 15).length;
  const onset = circularMeanMinutes(rows.map((r) => r.onsetMin).filter((v): v is number => v !== undefined));
  const wake = circularMeanMinutes(rows.map((r) => r.wakeMin).filter((v): v is number => v !== undefined));
  const name = `${MONTHS[month.m]} ${month.y}`;
  const arrows = (
    <Row gap={0} style={{ marginRight: -space.sm }}>
      <IconButton icon="chevron-left" label="Previous month" color={colors.text} onPress={() => onShift(-1)} />
      <IconButton icon="chevron-right" label="Next month" color={colors.text} onPress={() => onShift(1)} />
    </Row>
  );
  if (!rows.length) return <Hero label={name} value="No nights" caption="Coming mornings show the wake-up planned for them." right={arrows} />;
  return (
    <Hero
      label={`${name} · average sleep`}
      value={formatDuration(mean(sleep))}
      caption={`Enough sleep on ${met} of ${rows.length} night${rows.length === 1 ? '' : 's'} · you need ${formatDuration(need)}${scores.length ? ` · average score ${Math.round(mean(scores))}` : ''}`}
      right={arrows}
    >
      {onset !== undefined && wake !== undefined ? (
        <Text style={[font.small, { marginTop: space.xs }]}>
          Usually asleep around {formatClock(normalizeMinutes(onset))}, up around {formatClock(normalizeMinutes(wake))}.
        </Text>
      ) : null}
    </Hero>
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
        <Section title={title}>
          <Card>
            <Text style={font.small}>No sleep recorded for the night that ended this morning.</Text>
            <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
              <Button small kind="secondary" icon="pencil-plus" label="Log it" onPress={() => router.push({ pathname: '/log-sleep', params: { date } })} />
            </View>
          </Card>
        </Section>
      );
    }
    const main = row.sleepMin! - row.napMin;
    const enough = main >= need - 15;
    return (
      <Section title={title}>
        <Card onPress={sessionId ? () => router.push({ pathname: '/night/[id]', params: { id: sessionId } }) : undefined}>
          <Row>
            <Stat label="Sleep" value={formatDuration(main)} sub={enough ? 'enough' : `${formatDuration(need - main)} short`} color={enough ? undefined : colors.warn} />
            <Stat label="Score" value={row.score !== undefined ? String(row.score) : '–'} color={row.score !== undefined ? scoreColor(row.score) : undefined} />
            <Stat label="Sleep debt" value={formatDuration(row.debtMin)} sub="that morning" />
            {sessionId ? <Icon name="chevron-right" color={colors.textFaint} /> : null}
          </Row>
          <Text style={[font.small, { marginTop: space.md }]}>
            {[
              row.onsetMin !== undefined && row.wakeMin !== undefined ? `Asleep ${formatClock(row.onsetMin)} → up ${formatClock(row.wakeMin)}` : undefined,
              row.deepPct !== undefined && row.remPct !== undefined ? `deep ${Math.round(row.deepPct * 100)}% · REM ${Math.round(row.remPct * 100)}%` : undefined,
              row.napMin > 0 ? `${formatDuration(row.napMin)} of naps that day` : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md }}>
              {tags.map((t) => (TAG_BY_ID[t] ? <Chip key={t} icon={TAG_BY_ID[t].icon} label={TAG_BY_ID[t].label} /> : null))}
            </View>
          ) : null}
        </Card>
      </Section>
    );
  }

  return (
    <Section title={title}>
      <Card>
        {props.canPlan ? (
          <>
            <View style={{ marginBottom: space.sm }}>
              <Caption>Wake-up that morning</Caption>
            </View>
            <WakePlanPicker date={date} />
          </>
        ) : null}
        {night ? (
          <NightBeforeStats night={night} needMin={need} isTonight={props.isTonight} />
        ) : props.canPlan ? (
          <Text style={[font.small, { marginTop: space.md }]}>The best bedtime for this morning appears two weeks ahead.</Text>
        ) : (
          <Text style={font.small}>Mornings can be planned up to {PLAN_AHEAD_DAYS} days ahead.</Text>
        )}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', marginBottom: space.xs },
  cell: { flex: 1, height: 58, margin: 1, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'flex-start', paddingTop: space.xs, gap: space.xxs },
  cellText: { ...font.tiny, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barTrack: { width: '70%', height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', marginTop: space.xxs },
  bar: { height: 4, borderRadius: 2 },
  swatch: { width: 10, height: 4, borderRadius: 2 },
});
