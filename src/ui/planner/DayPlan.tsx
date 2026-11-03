/**
 * Planning one morning — shared by the Planner's day card and the month calendar: the wake-up
 * choice (usual / a set time / free day), the routine alarm on or off for that morning (two-step
 * mornings), the optimal night before, and its notes.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { BODY_CLOCK, wakeTargetFor } from '@/engine/schedule';
import { addDays, dateKey, formatClock, formatDuration, formatTime, normalizeMinutes, weekdayOfKey } from '@/engine/time';
import { checkTwoStep, twoStepByWeek, twoStepSetting } from '@/engine/twoStep';
import type { DayWakePlan } from '@/engine/types';
import type { UpcomingNight } from '@/engine/weekPlan';
import { setWakePlanFor } from '@/state/routineSkip';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Note, Row, Segmented, Stat, Stepper } from '@/ui/components';
import { Toggle } from '@/ui/settings/Toggle';
import { colors, font, space } from '@/ui/theme';

import { DAY_NAMES, wakeChoiceHint } from './planText';

/** How far ahead mornings can be planned. */
export const PLAN_AHEAD_DAYS = 90;

/** Saves (or clears) one morning's wake plan (state/routineSkip.setWakePlanFor). */
export function useSetWakePlan(): (date: string, plan: DayWakePlan | undefined) => void {
  return (date, plan) => setWakePlanFor(date, plan);
}

/** The weekly-pattern wake-up for a date, ignoring anything set for that day. */
export function useUsualWake(date: string): { wakeMin: number; isWorkday: boolean } {
  const profile = useStore((s) => s.profile);
  return wakeTargetFor({ ...profile, wakePlan: undefined }, date);
}

/** Usual / Set a time / Free day for one morning, with a one-line explanation of the choice. */
export function WakePlanPicker({ date }: { date: string }) {
  const plan = useStore((s) => s.profile.wakePlan?.[date]);
  const freeWakeMin = useStore((s) => s.profile.freeWakeMin ?? s.profile.workWakeMin + 60);
  const usual = useUsualWake(date);
  const setPlan = useSetWakePlan();
  const mode: 'usual' | 'custom' | 'free' = plan?.free ? 'free' : plan?.wakeMin !== undefined ? 'custom' : 'usual';
  const customMin = plan?.wakeMin ?? usual.wakeMin;
  // The routine-alarm choice for this date survives changing the wake-up (a free day has no alarms, so it drops it).
  const save = (next: DayWakePlan) => {
    const merged: DayWakePlan = next.free ? next : { ...(plan?.twoStep !== undefined ? { twoStep: plan.twoStep } : {}), ...next };
    setPlan(date, Object.keys(merged).length ? merged : undefined);
  };
  return (
    <View>
      <Segmented
        value={mode}
        onChange={(m) => save(m === 'usual' ? {} : m === 'free' ? { free: true } : { wakeMin: customMin })}
        options={[
          { label: `Usual · ${formatClock(usual.wakeMin)}`, value: 'usual' },
          { label: 'Set a time', value: 'custom' },
          { label: 'Free day', value: 'free' },
        ]}
      />
      <Text style={[font.small, { marginTop: 6 }]}>{wakeChoiceHint(mode, usual, formatClock(usual.wakeMin), formatClock(freeWakeMin))}</Text>
      {mode === 'custom' ? (
        <Stepper
          label="Up by"
          sub="15-minute steps"
          value={formatClock(customMin)}
          onDec={() => save({ wakeMin: normalizeMinutes(customMin - 15) })}
          onInc={() => save({ wakeMin: normalizeMinutes(customMin + 15) })}
        />
      ) : null}
      <RoutineChoice date={date} />
    </View>
  );
}

/**
 * Two-step mornings for one date: the routine alarm on or off for just that morning. Shown once
 * two-step mornings have been set up (Planner › Your usual week), on mornings with an alarm.
 */
export function RoutineChoice({ date }: { date: string }) {
  const profile = useStore((s) => s.profile);
  const setPlan = useSetWakePlan();
  if (!profile.twoStepMorning) return null;
  const target = wakeTargetFor(profile, date);
  if (target.noAlarm) return null;
  const setting = twoStepSetting(profile);
  // The times have to work for the routine to be switched on at all (the weekly card explains why not).
  const check = checkTwoStep({ ...profile, twoStepMorning: { ...setting, enabled: true } });
  if (!check.ok) return null;
  const plan = profile.wakePlan?.[date];
  const choice = plan?.twoStep;
  const byWeek = twoStepByWeek(profile, date, target);
  const on = choice ?? byWeek;
  const first = normalizeMinutes(target.wakeMin - check.config.gapMin);
  const why =
    choice === undefined
      ? setting.enabled
        ? `as usual for ${DAY_NAMES[weekdayOfKey(date)]}s`
        : 'two-step mornings are off — this turns it on for just this morning'
      : 'just this morning';
  const sub = on
    ? `Up ${formatClock(first)} for your ${check.config.routineMin}-min routine, back to sleep until ${formatClock(target.wakeMin)} · ${why}`
    : `One alarm at ${formatClock(target.wakeMin)} · ${why}`;
  const change = (v: boolean) => {
    const next: DayWakePlan = { ...plan };
    // Back to what the week says: forget the choice so later changes to the weekly setting apply.
    if (v === byWeek) delete next.twoStep;
    else next.twoStep = v;
    setPlan(date, Object.keys(next).length ? next : undefined);
  };
  return <Toggle label="Routine alarm this morning" sub={sub} value={on} onChange={change} />;
}

/** Why a night is earlier, shorter or longer than usual (held back by the body clock, easing into an early start, paying back debt). */
export function NightNotes({ night, needMin }: { night: UpcomingNight; needMin: number }) {
  const heldShort = night.heldBack && night.sleepMin < needMin - 30;
  // The pace coming nights are planned at: what your sleep onset has actually kept up lately.
  const ramp = useAnalysis()?.advance?.rampMinPerNight ?? BODY_CLOCK.rampMinPerNight;
  return (
    <>
      {heldShort ? (
        <Note tone="warn" icon="clock-alert-outline">
          {`Your body clock isn't ready for a much earlier lights-out yet, so this night runs ${formatDuration(needMin - night.sleepMin)} short. eepy moves lights-out about ${ramp} min earlier each night as you catch up — bright light soon after waking speeds it up, and a 20-min nap before 2 PM takes the edge off.`}
        </Note>
      ) : null}
      {heldShort && night.twoStep ? <SkipRoutineForShortNight night={night} /> : null}
      {night.preShiftMin > 0 && night.preShiftFor ? (
        <Note icon="arrow-collapse-left">
          {`${formatDuration(night.preShiftMin)} earlier than usual to ease into ${DAY_NAMES[weekdayOfKey(night.preShiftFor)]}'s early start — the body clock only moves earlier gradually.`}
        </Note>
      ) : null}
      {night.extraForDebtMin > 0 && !heldShort ? (
        <Note tone="good" icon="battery-charging-medium">
          {`+${night.extraForDebtMin} min in bed to pay back some sleep debt.`}
        </Note>
      ) : null}
    </>
  );
}

/** On a short two-step night, the routine comes out of sleep you don't have: offer to skip it that morning. */
function SkipRoutineForShortNight({ night }: { night: UpcomingNight }) {
  const plan = useStore((s) => s.profile.wakePlan?.[night.wakeDate]);
  const setPlan = useSetWakePlan();
  if (!night.twoStep || plan?.twoStep === false) return null;
  return (
    <View style={{ marginTop: space.sm, alignItems: 'flex-start' }}>
      <Button
        small
        kind="secondary"
        icon="alarm-off"
        label={`Skip the routine that morning · +${night.twoStep.awakeMin} min sleep`}
        onPress={() => setPlan(night.wakeDate, { ...plan, twoStep: false })}
      />
    </View>
  );
}

/** The optimal night before a morning: wind-down, lights-out and alarm, expected sleep and notes. */
export function NightBeforeStats({ night, needMin, isTonight }: { night: UpcomingNight; needMin: number; isTonight: boolean }) {
  return (
    <View style={{ marginTop: space.md }}>
      <Text style={font.label}>BEST PLAN FOR THE NIGHT BEFORE</Text>
      <Row style={{ marginTop: 4 }}>
        <Stat label="Wind down" value={formatTime(night.windDownStart)} />
        <Stat label="Lights out" value={formatTime(night.bedtime)} color={colors.accent} />
        <Stat
          label={night.noAlarm ? 'Wake (free)' : night.twoStep ? 'Routine alarm' : 'Alarm'}
          value={night.alarm ? formatTime(night.alarm) : formatTime(night.wake)}
          sub={night.noAlarm ? 'no alarm' : night.twoStep ? `then up ${formatTime(night.wake)}` : night.cycles ? `${night.cycles} sleep cycles` : undefined}
        />
      </Row>
      <Text style={[font.small, { marginTop: space.sm }]}>
        Expected sleep {formatDuration(night.sleepMin)} (you need {formatDuration(needMin)}).
      </Text>
      <View style={{ marginTop: space.sm }}>
        <NightNotes night={night} needMin={needMin} />
      </View>
      {isTonight ? <AdjustTonightButton /> : null}
    </View>
  );
}

export function AdjustTonightButton({ primary }: { primary?: boolean }) {
  const a = useAnalysis();
  // Only tonight's own times count (an earlier night's override — e.g. from "I'm in bed" — is ignored by the plan).
  const adjusted = useStore((s) => !!s.settings.tonight && (!a || s.settings.tonight.wakeDate === a.tonight.wakeDate));
  return (
    <View style={{ marginTop: space.sm, alignItems: primary ? 'stretch' : 'flex-start' }}>
      <Button
        small={!primary}
        kind={primary ? 'primary' : 'secondary'}
        icon="clock-edit-outline"
        label={adjusted ? 'Change tonight’s times' : 'Can’t make it? Adjust tonight'}
        onPress={() => router.push('/tonight')}
      />
    </View>
  );
}
