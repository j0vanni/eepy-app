/**
 * Today, around a two-step morning's routine (from an hour before the routine alarm until the final
 * alarm): before it, "Routine alarm at 5:00 — up at 6:00" with **Skip the routine — sleep until 6:00**;
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
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { formatTime } from '@/engine/time';
import { routineNow, syncWakeAlarm, WAKE_FINAL_SKIP_MARK } from '@/notifications/fullScreenAlarm';
import { replanNotifications } from '@/notifications/scheduler';
import { hasSleepMode, startSleepModeNow, stopSleepModeNow } from '@/notifications/sleepMode';
import { endInBedSession, undoEndInBedSession } from '@/state/inBed';
import { RoutineSkipUndo, skipRoutine, undoSkipRoutine } from '@/state/routineSkip';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { Button, Card, Icon, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { colors, font, space } from '@/ui/theme';

/** The card shows from this long before the routine alarm, so you can skip the routine if you're awake early. */
export const ROUTINE_CARD_LEAD_MIN = 60;

/** Dim, like Today's night view: it's still dark and the point is to go back to sleep. */
const DIM_CARD = { backgroundColor: '#0A0E1C', borderColor: '#161C33' };

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
  if (!analysis || !r) return null;

  const final = formatTime(r.finalAt);
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

  const routine = formatTime(r.routineAt);
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

  if (r.routineSkipped && !r.skipped) {
    return (
      <Card style={DIM_CARD}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Icon name="sleep" size={20} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={font.label}>ROUTINE SKIPPED</Text>
            <Text style={[font.h2, { color: colors.textDim, marginTop: 2 }]}>Sleep until {final}.</Text>
            <Text style={[font.small, { marginTop: 4 }]}>
              {r.eepyAlarm ? `The ${routine} routine alarm is off; the ${final} alarm still rings.` : `Turn off your own ${routine} alarm — your ${final} one stays.`} An early
              wake-up this morning counts as waking, not as your routine.
            </Text>
          </View>
        </Row>
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="ghost" icon="undo" label={now < r.routineAt ? `Undo — routine alarm at ${routine}` : 'Undo — I did my routine'} disabled={busy} onPress={undoRoutineSkip} />
        </View>
      </Card>
    );
  }

  if (now < r.routineAt) {
    return (
      <Card style={DIM_CARD} accent="#1F2647">
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Icon name="face-woman-shimmer-outline" size={20} color={colors.light} />
          <View style={{ flex: 1 }}>
            <Text style={font.label}>MORNING ROUTINE</Text>
            <Text style={[font.h2, { color: colors.textDim, marginTop: 2 }]}>
              Routine alarm at {routine} — up at {final}.
            </Text>
            <Text style={[font.small, { marginTop: 4 }]}>Not doing it today? Skip it and sleep straight through to {final}.</Text>
          </View>
        </Row>
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="sleep" label={`Skip the routine — sleep until ${final}`} disabled={busy} onPress={skipTheRoutine} />
        </View>
      </Card>
    );
  }

  if (r.skipped) {
    return (
      <Card style={DIM_CARD}>
        <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
          <Icon name="weather-sunset-up" size={20} color={colors.energy} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>Staying up — the {final} alarm is off</Text>
            <Text style={[font.small, { marginTop: 2 }]}>Get some daylight soon. With no sleep after your routine, eepy counts it as your wake-up.</Text>
          </View>
        </Row>
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="ghost" icon="undo" label={`Undo — alarm at ${final}`} disabled={busy} onPress={() => setSkipped(false)} />
        </View>
      </Card>
    );
  }

  const backToBed = now < r.backToBedBy;
  return (
    <Card style={DIM_CARD} accent="#1F2647">
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <Icon name="face-woman-shimmer-outline" size={20} color={colors.light} />
        <View style={{ flex: 1 }}>
          <Text style={font.label}>MORNING ROUTINE</Text>
          <Text style={[font.h2, { color: colors.textDim, marginTop: 2 }]}>
            {backToBed ? `Back to bed by ${formatTime(r.backToBedBy)}` : 'Back to bed'} — alarm at {final}.
          </Text>
          <Text style={[font.small, { marginTop: 4 }]}>
            Lights low, screens off.{watchFirst ? ` Your watch buzzes at ${final}, the phone at ${formatTime(r.finalPhoneAt)}.` : ''}
          </Text>
        </View>
      </Row>
      <View style={{ marginTop: space.md, gap: space.sm, alignItems: 'flex-start' }}>
        <Button small kind="secondary" icon="sleep" label={`Skip it — back to sleep until ${final}`} disabled={busy} onPress={skipTheRoutine} />
        {r.eepyAlarm ? <Button small kind="ghost" icon="alarm-off" label={`Staying up? Skip the ${final} alarm`} disabled={busy} onPress={() => setSkipped(true)} /> : null}
      </View>
      {r.eepyAlarm ? null : <Text style={[font.tiny, { marginTop: space.sm }]}>From your two-step plan — your own alarm rings.</Text>}
    </Card>
  );
}
