/**
 * Today, around a two-step morning's routine (from an hour before the routine alarm until the final
 * alarm): before it, "Routine alarm 5:00, up at 6:00" with **Skip the routine — sleep until 6:00**;
 * during it, "Back to bed by 5:20 — alarm at 6:05. Lights low, screens off." with **Skip it — back to
 * sleep** and "Staying up? Skip the 6:05 alarm" (each with Undo). Renders nothing outside that
 * window, so it can sit at the top of Today all the time. The routine alarm's "I'm up" opens Today
 * (fullScreenAlarm.ROUTINE_ALARM_LINK).
 *
 * Skipping the routine (state/routineSkip.ts) stops the routine alarm, keeps the final one and records
 * the morning as a one-alarm morning. Skipping the final alarm uses WAKE_FINAL_SKIP_MARK: only the
 * final alarm, and the morning isn't treated as a free one. It re-plans the alarms right away and
 * switches the phone's sleep mode off (on again on Undo), and ends a running sleep session ("I'm up";
 * Undo opens it again).
 */
import { ReactNode, useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { dateKey, formatTime } from '@/engine/time';
import { routineNow, syncWakeAlarm, WAKE_FINAL_SKIP_MARK, WAKE_UP_EARLY_MARK } from '@/notifications/fullScreenAlarm';
import { replanNotifications } from '@/notifications/scheduler';
import { hasSleepMode, startSleepModeNow, stopSleepModeNow } from '@/notifications/sleepMode';
import { endInBedSession, undoEndInBedSession } from '@/state/inBed';
import { RoutineSkipUndo, skipRoutine, undoSkipRoutine } from '@/state/routineSkip';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { Button, Card } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { font, night, space } from '@/ui/theme';
import { Caption, NIGHT_PANEL } from '@/ui/today/nightParts';

/** The card shows from this long before the routine alarm, so you can skip the routine if you're awake early. */
export const ROUTINE_CARD_LEAD_MIN = 60;

/**
 * One dim panel (it's still dark and the point is to go back to sleep): what is happening, one
 * line under it, and the one or two things you can do about it.
 */
function Panel({ label, title, sub, foot, children }: { label: string; title: ReactNode; sub: ReactNode; foot?: string; children: ReactNode }) {
  return (
    <Card style={NIGHT_PANEL}>
      <Caption>{label}</Caption>
      <Text style={[font.h2, { color: night.text, marginTop: space.xs }]}>{title}</Text>
      <Text style={[font.small, { color: night.textDim, marginTop: space.xs }]}>{sub}</Text>
      <View style={{ marginTop: space.md, gap: space.sm }}>{children}</View>
      {foot ? <Text style={[font.tiny, { marginTop: space.sm }]}>{foot}</Text> : null}
    </Card>
  );
}

export function RoutineMorningNow({ a }: { a?: Analysis }) {
  const shared = useAnalysis();
  const analysis = a ?? shared;
  const now = useNow(30_000);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const setMark = useStore((s) => s.setMark);
  const [busy, setBusy] = useState(false);
  const [skipUndo, setSkipUndo] = useState<RoutineSkipUndo>();
  // From an hour before the routine alarm: up early (or awake anyway) and not doing it today.
  const r = analysis ? routineNow(analysis, settings, profile, now, { leadMin: ROUTINE_CARD_LEAD_MIN }) : undefined;
  // Up for the day already ("I'm up" before the alarm): its own card says so, with Undo.
  const upEarly = settings.marks[WAKE_UP_EARLY_MARK];
  if (!analysis || !r || (typeof upEarly === 'number' && dateKey(upEarly) === r.date)) return null;

  const final = formatTime(r.finalAt);
  const routine = formatTime(r.routineAt);
  const watchFirst = r.finalPhoneAt !== r.finalAt;
  // The alarms (and the planner fallback) follow the new mark right away, not at the next re-plan.
  const replan = () => {
    const state = useStore.getState();
    replanNotifications(analysis, state).catch(() => undefined);
    syncWakeAlarm(analysis, state).catch(() => undefined);
  };
  const setSkipped = async (skip: boolean) => {
    setBusy(true);
    if (skip) confirmHaptic();
    setMark(WAKE_FINAL_SKIP_MARK, skip ? r.date : undefined);
    replan();
    // Staying up: that's "I'm up" for tonight's sleep session too.
    await (skip ? endInBedSession('routine', analysis) : undoEndInBedSession()).catch(() => undefined);
    // Up for the day: lights on. Back to bed: sleep mode again until the final alarm.
    if (hasSleepMode() && settings.sleepMode.enabled) {
      await (skip ? stopSleepModeNow(r.date) : startSleepModeNow(r.date, r.finalAt)).catch(() => false);
    }
    setBusy(false);
  };
  const skipTheRoutine = async () => {
    setBusy(true);
    confirmHaptic();
    setSkipUndo(await skipRoutine(r.date, analysis).catch(() => undefined));
    setBusy(false);
  };
  const undoRoutineSkip = async () => {
    setBusy(true);
    await undoSkipRoutine(skipUndo ?? { date: r.date }, analysis).catch(() => undefined);
    setSkipUndo(undefined);
    setBusy(false);
  };

  // Skipped the routine: one alarm left.
  if (r.routineSkipped && !r.skipped) {
    return (
      <Panel
        label="Routine skipped"
        title={<>Sleep until {final}.</>}
        sub={r.eepyAlarm ? `The ${routine} routine alarm is off; the ${final} alarm still rings.` : `Turn off your own ${routine} alarm. Your ${final} one stays.`}
      >
        <Button kind="ghost" icon="undo" label={now < r.routineAt ? `Undo — routine alarm at ${routine}` : 'Undo — I did my routine'} disabled={busy} onPress={undoRoutineSkip} />
      </Panel>
    );
  }

  // Awake before the routine alarm.
  if (now < r.routineAt) {
    return (
      <Panel label="Morning routine" title={`Routine alarm ${routine}, up at ${final}`} sub={`Not doing it today? Sleep straight through to ${final}.`}>
        <Button kind="secondary" icon="sleep" label={`Skip the routine — sleep until ${final}`} disabled={busy} onPress={skipTheRoutine} />
      </Panel>
    );
  }

  // Staying up after the routine: the final alarm is off.
  if (r.skipped) {
    return (
      <Panel label="Morning routine" title={`Staying up — the ${final} alarm is off`} sub="Get some daylight soon. eepy counts this as your wake-up.">
        <Button kind="ghost" icon="undo" label={`Undo — alarm at ${final}`} disabled={busy} onPress={() => setSkipped(false)} />
      </Panel>
    );
  }

  // During the routine.
  const backToBed = now < r.backToBedBy;
  return (
    <Panel
      label="Morning routine"
      title={
        <>
          {backToBed ? `Back to bed by ${formatTime(r.backToBedBy)}` : 'Back to bed'} — alarm at {final}.
        </>
      }
      sub={`Lights low, screens off.${watchFirst ? ` Your watch buzzes at ${final}, the phone at ${formatTime(r.finalPhoneAt)}.` : ''}`}
      foot={r.eepyAlarm ? undefined : 'From your two-step plan. Your own alarm rings.'}
    >
      <Button kind="secondary" icon="sleep" label={`Skip it — back to sleep until ${final}`} disabled={busy} onPress={skipTheRoutine} />
      {r.eepyAlarm ? <Button kind="ghost" icon="alarm-off" label={`Staying up? Skip the ${final} alarm`} disabled={busy} onPress={() => setSkipped(true)} /> : null}
    </Panel>
  );
}
