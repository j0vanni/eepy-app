/**
 * "Your 5:00 AM routine: Did it / Skipped it" — for a two-step morning where nothing was tapped at the
 * time (slept through the routine alarm, or turned it off without telling eepy). eepy's guess comes
 * from the night (wake-up detection found the routine or not); your answer is saved to that morning
 * and the night is re-read with it (state/routineSkip.ts).
 *
 * `compact` is a question inside Today's morning panel (no panel of its own); otherwise it is a
 * panel on the night screen.
 */
import { Text, View } from 'react-native';

import type { SessionMetrics } from '@/engine/sessions';
import { formatTime } from '@/engine/time';
import type { NightTimeline } from '@/engine/wakeDetect';
import { plannedRoutineFor, RoutineOutcome, routineOutcome, setRoutineOutcome } from '@/state/routineSkip';
import { useStore } from '@/state/store';
import { Card, Chip, Row } from '@/ui/components';
import { confirmHaptic } from '@/ui/haptics';
import { font, space } from '@/ui/theme';

const CHOICES: { value: RoutineOutcome; label: string; icon: string }[] = [
  { value: 'done', label: 'Did it', icon: 'check' },
  { value: 'skipped', label: 'Skipped it', icon: 'sleep' },
];

export function RoutineCheck({ m, t, compact }: { m: SessionMetrics; t?: NightTimeline; compact?: boolean }) {
  const profile = useStore((s) => s.profile);
  const date = m.wakeDate;
  const outcome = routineOutcome(profile, date);
  const planned = plannedRoutineFor(profile, date);
  // Only mornings that had a routine planned, or that you've already answered for.
  if (m.isNap || (!planned && outcome === undefined)) return null;
  const guess: RoutineOutcome = t?.routine ? 'done' : 'skipped';
  const value = outcome ?? guess;
  const at = planned ? formatTime(planned.firstWake) : undefined;
  const title = at ? `Your ${at} routine` : 'Your morning routine';
  const hint =
    outcome !== undefined
      ? outcome === 'skipped'
        ? 'Saved — an early wake-up that morning counts as waking, not as your routine.'
        : 'Saved — the time up for it counts as your routine, not as waking in the night.'
      : guess === 'done'
        ? `eepy saw you up around ${formatTime(t!.routine!.start)} and counted it as your routine. Not right? Tap "Skipped it".`
        : 'eepy didn\'t see you up for it, so it counted the morning as skipped. Not right? Tap "Did it".';
  const pick = (v: RoutineOutcome) => {
    confirmHaptic();
    setRoutineOutcome(date, v);
  };
  const body = (
    <>
      <Text style={[font.h3, { marginBottom: space.sm }]}>
        {title}
        {compact ? ' this morning?' : ': did you do it?'}
      </Text>
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {CHOICES.map((c) => (
          <Chip key={c.value} icon={c.icon} label={c.label} selected={value === c.value} onPress={() => pick(c.value)} />
        ))}
      </Row>
      <Text style={[font.tiny, { marginTop: space.sm }]}>{hint}</Text>
    </>
  );
  // In Today's morning panel the next question follows straight after.
  return compact ? <View style={{ marginBottom: space.lg }}>{body}</View> : <Card>{body}</Card>;
}
