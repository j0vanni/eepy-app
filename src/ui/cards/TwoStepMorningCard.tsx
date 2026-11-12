/**
 * Two-step mornings (engine/twoStep.ts): "up at 5 for my face routine, back to sleep until 6:05".
 * One switch; once on, the routine alarm, how long the routine takes and which mornings, with the
 * next two-step night from the shared analysis ("Lights out 11:05 PM → 4:47 routine alarm → back
 * to sleep ~5:17 → up 6:05").
 *
 * Self-contained: reads and writes Profile.twoStepMorning and needs no props. `embedded` drops the
 * panel so it can sit as a row inside another panel (Plan → Your usual week, Settings).
 */
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { clockDiff, formatClock, formatDuration, normalizeMinutes } from '@/engine/time';
import { checkTwoStep, switchTwoStep, TWO_STEP, twoStepLine, twoStepSetting, twoStepSleep } from '@/engine/twoStep';
import type { TwoStepMorning } from '@/engine/types';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, Fold, KeyValue, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { selectionTick } from '@/ui/haptics';
import { Bullet, Caption, DayPicker, WEEK_ORDER } from '@/ui/planner/parts';
import { DAY_NAMES, DAY_SHORT } from '@/ui/planner/planText';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, space } from '@/ui/theme';

const STEP_MIN = 5;

function listDays(days: number[]): string {
  const names = WEEK_ORDER.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The next two-step night in the plan, as one line plus how the sleep splits. */
function Preview({ a }: { a: Analysis }) {
  const next = a.upcoming.find((n) => n.twoStep);
  if (!next?.twoStep) {
    return <Text style={font.small}>No two-step mornings in the next two weeks. Free days, days off and dates you switched the routine off for keep one alarm.</Text>;
  }
  const two = next.twoStep;
  const sleep = twoStepSleep(next.bedtime, two, a.latencyMin, a.efficiency);
  const short = Math.round(a.need.needMin - sleep.totalMin);
  return (
    <View style={{ gap: space.xs }}>
      <Caption>{dayLabel(next.wakeDate)}</Caption>
      <Text style={[font.body, { fontVariant: ['tabular-nums'] }]}>{twoStepLine({ bedtime: next.bedtime, wake: next.wake, twoStep: two }, a.latencyMin, a.efficiency)}</Text>
      <Text style={font.small}>
        {formatDuration(sleep.mainMin)} before the routine + {formatDuration(sleep.backMin)} after it.
        {next.heldBack ? '' : ` Lights out is ${two.awakeMin} min earlier than on a one-alarm night, so the routine doesn't come out of your sleep.`}
      </Text>
      {short > 15 ? (
        <Bullet icon="clock-alert-outline" color={colors.warn} strong>
          About {formatDuration(short)} short of your {formatDuration(a.need.needMin)} need. Your body clock won't let lights-out move that much earlier at once.
        </Bullet>
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

  const body = (
    <>
      <Toggle
        label="Two-step mornings"
        sub="A gentle alarm for a short routine, back to bed, then your normal wake-up."
        value={setting.enabled}
        onChange={(v) => save(switchTwoStep(setting, v, Date.now()))}
      />
      {setting.enabled ? (
        <View style={{ paddingBottom: space.md }}>
          <Stepper
            label="Routine alarm"
            sub={gap > 0 ? `${formatDuration(gap)} before your wake-up · rings up to 30 min earlier, at the end of a sleep cycle` : 'Must be before your wake-up'}
            value={formatClock(setting.firstWakeMin)}
            onDec={() => update({ firstWakeMin: normalizeMinutes(setting.firstWakeMin - STEP_MIN) })}
            onInc={() => update({ firstWakeMin: normalizeMinutes(setting.firstWakeMin + STEP_MIN) })}
          />
          <Stepper
            label="Routine"
            sub={`Lights low · back in bed by about ${formatClock(routineEnd)}`}
            value={`${setting.routineMin} min`}
            onDec={() => update({ routineMin: Math.max(TWO_STEP.routineMin.min, setting.routineMin - STEP_MIN) })}
            onInc={() => update({ routineMin: Math.min(TWO_STEP.routineMin.max, setting.routineMin + STEP_MIN) })}
          />
          <KeyValue label="Final alarm" sub={`Your workday wake-up${gap > 0 ? ` · calendar wake-ups keep the ${formatDuration(gap)} gap` : ''}`} value={formatClock(profile.workWakeMin)} />
          <View style={{ marginTop: space.sm, marginBottom: space.sm }}>
            <Caption>Mornings</Caption>
          </View>
          <DayPicker days={days} onToggle={toggleDay} short={DAY_SHORT} label={(d) => DAY_NAMES[d]} />
          {offDays.length ? (
            <Text style={[font.tiny, { marginTop: space.sm }]}>{`${listDays(offDays)} ${offDays.length > 1 ? "aren't workdays" : "isn't a workday"}: two-step only when you set a wake-up for that date.`}</Text>
          ) : null}
          <Text style={[font.tiny, { marginTop: space.sm }]}>For one date only, tap that morning in the Plan tab's week and use “Routine alarm this morning”.</Text>
          <View style={{ marginTop: space.md }}>
            {!check.ok ? (
              <Bullet icon="alert-outline" color={colors.warn} strong>
                {check.reason}
              </Bullet>
            ) : a ? (
              <Preview a={a} />
            ) : (
              <Text style={font.small}>
                {formatClock(setting.firstWakeMin)} routine alarm → back to sleep ~{formatClock(routineEnd + TWO_STEP.fallBackAsleepMin)} → up {formatClock(profile.workWakeMin)} on{' '}
                {listDays(days)}.
              </Text>
            )}
          </View>
          <View style={{ marginTop: space.sm }}>
            <Fold bare title="How it works">
              <Text style={font.small}>
                The routine alarm rings at the end of a sleep cycle, so it is easy to get up. The final one rings right at your wake-up. Sleep mode stays on until then, and the routine doesn't
                count as waking in the night.
              </Text>
            </Fold>
          </View>
        </View>
      ) : null}
    </>
  );

  if (embedded) return <View>{body}</View>;
  return <Card style={{ paddingVertical: space.xs }}>{body}</Card>;
}
