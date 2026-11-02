/**
 * Two-step mornings (engine/twoStep.ts): "up at 5 for my face routine, back to sleep until 6:05".
 * On/off, the routine alarm, how long the routine takes and which mornings, with a live preview of
 * the next two-step night from the shared analysis ("Lights out 11:05 PM → 4:47 routine alarm →
 * back to sleep ~5:17 → up 6:05 · 7h 10m sleep").
 *
 * Self-contained: reads and writes Profile.twoStepMorning and needs no props — mount it in the
 * planner or Settings (`embedded` drops the card frame to sit inside another card or section).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { clockDiff, formatClock, formatDuration, normalizeMinutes } from '@/engine/time';
import { checkTwoStep, switchTwoStep, TWO_STEP, twoStepLine, twoStepSetting, twoStepSleep } from '@/engine/twoStep';
import type { TwoStepMorning } from '@/engine/types';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { AppSwitch, Card, CardTitle, Icon, Note, Row, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { selectionTick } from '@/ui/haptics';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, radius, space } from '@/ui/theme';

const DAY_CHIPS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Show Monday first. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STEP_MIN = 5;

function listDays(days: number[]): string {
  const names = DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The next two-step night in the plan, as one line plus how the sleep splits. */
function Preview({ a }: { a: Analysis }) {
  const next = a.upcoming.find((n) => n.twoStep);
  if (!next?.twoStep) {
    return <Text style={font.small}>No two-step mornings in the next two weeks — free days, days off and dates you switched the routine off for keep one alarm.</Text>;
  }
  const two = next.twoStep;
  const sleep = twoStepSleep(next.bedtime, two, a.latencyMin, a.efficiency);
  const short = Math.round(a.need.needMin - sleep.totalMin);
  return (
    <View style={{ gap: 4 }}>
      <Text style={font.label}>{dayLabel(next.wakeDate).toUpperCase()}</Text>
      <Text style={[font.body, { fontVariant: ['tabular-nums'] }]}>{twoStepLine({ bedtime: next.bedtime, wake: next.wake, twoStep: two }, a.latencyMin, a.efficiency)}</Text>
      <Text style={font.small}>
        {formatDuration(sleep.mainMin)} before the routine + {formatDuration(sleep.backMin)} after it.
        {next.heldBack ? '' : ` Lights out ${two.awakeMin} min earlier than a one-alarm night, so the routine and falling back asleep don't come out of your sleep.`}
      </Text>
      {short > 15 ? (
        <Note tone="warn" icon="clock-alert-outline">
          About {formatDuration(short)} short of your {formatDuration(a.need.needMin)} need — your body clock won't let lights-out move that much earlier at once.
        </Note>
      ) : null}
    </View>
  );
}

export function TwoStepMorningCard({ embedded = false }: { embedded?: boolean }) {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const a = useAnalysis();
  const setting = twoStepSetting(profile);
  const check = checkTwoStep(profile);
  const days = setting.days ?? profile.workdays;
  const gap = clockDiff(setting.firstWakeMin, profile.workWakeMin);
  const offDays = days.filter((d) => !profile.workdays.includes(d));

  const save = (next: TwoStepMorning) => setProfile({ twoStepMorning: next });
  const update = (patch: Partial<TwoStepMorning>) => {
    selectionTick();
    save({ ...setting, ...patch });
  };
  const toggleDay = (d: number) => update({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((x, y) => x - y) });
  const routineEnd = setting.firstWakeMin + setting.routineMin;

  const describe = 'A gentle alarm for a short routine (washing, moisturiser), back to bed, then your normal wake-up.';
  const onSwitch = (v: boolean) => save(switchTwoStep(setting, v, Date.now()));
  const body = (
    <>
      {/* In a card the switch sits in the title; embedded (inside another card) it's a plain row. */}
      {embedded ? <Toggle label="Two-step mornings" sub={describe} value={setting.enabled} onChange={onSwitch} /> : null}
      {setting.enabled ? (
        <>
          <Stepper
            label="Routine alarm"
            sub={gap > 0 ? `${formatDuration(gap)} before your wake-up · cycle-timed, up to 30 min earlier` : 'Must be before your wake-up'}
            value={formatClock(setting.firstWakeMin)}
            onDec={() => update({ firstWakeMin: normalizeMinutes(setting.firstWakeMin - STEP_MIN) })}
            onInc={() => update({ firstWakeMin: normalizeMinutes(setting.firstWakeMin + STEP_MIN) })}
          />
          <Stepper
            label="Routine"
            sub={`Up with the lights low · back in bed by ~${formatClock(routineEnd)}`}
            value={`${setting.routineMin} min`}
            onDec={() => update({ routineMin: Math.max(TWO_STEP.routineMin.min, setting.routineMin - STEP_MIN) })}
            onInc={() => update({ routineMin: Math.min(TWO_STEP.routineMin.max, setting.routineMin + STEP_MIN) })}
          />
          <Row gap={space.sm} style={{ paddingVertical: space.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={font.body}>Final alarm</Text>
              <Text style={font.small}>Your workday wake-up{gap > 0 ? ` · calendar wake-ups keep the ${formatDuration(gap)} gap` : ''}</Text>
            </View>
            <Text style={[font.h3, { minWidth: 76, textAlign: 'center' }]}>{formatClock(profile.workWakeMin)}</Text>
          </Row>
          <Text style={[font.small, { marginTop: space.xs }]}>Mornings</Text>
          {/* One even row of seven, like the workday picker above. */}
          <Row gap={4} style={{ marginTop: space.xs }}>
            {DAY_ORDER.map((d) => {
              const on = days.includes(d);
              return (
                <Pressable
                  key={d}
                  onPress={() => toggleDay(d)}
                  style={({ pressed }) => [styles.day, on ? styles.dayOn : null, pressed ? { opacity: 0.7 } : null]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={DAY_NAMES[d]}
                >
                  <Text style={[styles.dayText, on ? { color: colors.onAccent } : null]}>{DAY_CHIPS[d]}</Text>
                </Pressable>
              );
            })}
          </Row>
          {offDays.length ? (
            <Text style={[font.tiny, { marginTop: space.xs }]}>
              {listDays(offDays)} {offDays.length > 1 ? "aren't workdays" : "isn't a workday"} — only two-step when you set a wake-up for it in the calendar.
            </Text>
          ) : null}
          <Text style={[font.tiny, { marginTop: space.xs }]}>Want it on or off for one date? Tap that morning in the Planner's week (or use Tonight's plan) → "Routine alarm this morning".</Text>
          <View style={{ marginTop: space.md }}>
            {!check.ok ? (
              <Note tone="warn">{check.reason}</Note>
            ) : a ? (
              <Preview a={a} />
            ) : (
              <Text style={font.small}>
                {formatClock(setting.firstWakeMin)} routine alarm → back to sleep ~{formatClock(routineEnd + TWO_STEP.fallBackAsleepMin)} → up {formatClock(profile.workWakeMin)} on{' '}
                {listDays(days)}.
              </Text>
            )}
          </View>
          <Row gap={6} style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Icon name="information-outline" size={16} color={colors.textFaint} />
            <Text style={[font.tiny, { flex: 1 }]}>
              The routine alarm is cycle-timed so it's easy to get up; the final one rings right at your wake-up. Sleep mode stays on until then, and the routine doesn't
              count as waking in the night.
            </Text>
          </Row>
        </>
      ) : null}
    </>
  );

  if (embedded) return <View>{body}</View>;
  return (
    <Card>
      <CardTitle
        icon="weather-sunset-up"
        title="Two-step mornings"
        color={colors.energy}
        right={<AppSwitch value={setting.enabled} onChange={onSwitch} label="Two-step mornings" />}
      />
      <Text style={[font.small, setting.enabled ? { marginBottom: space.xs } : null]}>{describe}</Text>
      {body}
    </Card>
  );
}

const styles = StyleSheet.create({
  day: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.text, fontWeight: '700', fontSize: 13 },
});
