/**
 * Goals: up to three small daily wins. Opens with today — how many are done — then each goal you
 * keep as a row that opens to its streak, the last two weeks and its setting, then the list to
 * choose from.
 */
import { Text, View } from 'react-native';

import { defaultGoalTarget, GOAL_DEFS, GoalDef, GoalProgress, MAX_GOALS, setGoalTarget, toggleGoal, WIND_DOWN_TAG } from '@/engine/goals';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { GOAL_LEGEND, GOAL_STATUS_TEXT, GoalDots } from '@/ui/coach/Dots';
import { useGoalInput, useGoalsSummary } from '@/ui/coach/hooks';
import { Button, Card, Empty, Fold, Hero, KeyValue, ListCard, Meter, Screen, Section, Stepper } from '@/ui/components';
import { Toggle } from '@/ui/settings/Toggle';
import { font, scoreColor, space } from '@/ui/theme';

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** The one thing a goal lets you set: a time. */
function GoalParam({ def, progress }: { def: GoalDef; progress: GoalProgress }) {
  const goals = useStore((s) => s.goals);
  const setGoals = useStore((s) => s.setGoals);
  const profile = useStore((s) => s.profile);
  if (!def.param) return null;
  const id = def.id;
  const step = def.param.stepMin;
  const value = progress.setting.targetMin;
  if (id === 'in-bed-on-time') {
    // Optional: a fixed lights-out time instead of each night's plan.
    if (value === undefined) {
      return <KeyValue label="Lights-out" sub="Follows each night's plan. Tap to use a fixed time instead." value="The plan" onPress={() => setGoals(setGoalTarget(goals, id, 23 * 60))} />;
    }
    return (
      <View>
        <Stepper
          label="Fixed lights-out"
          value={formatClock(value)}
          onDec={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(value - step)))}
          onInc={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(value + step)))}
        />
        <View style={{ alignItems: 'flex-start' }}>
          <Button small kind="ghost" label="Follow the nightly plan instead" onPress={() => setGoals(setGoalTarget(goals, id, undefined))} />
        </View>
      </View>
    );
  }
  const cur = value ?? (id === 'consistent-wake' ? profile.workWakeMin : 14 * 60);
  return (
    <Stepper
      label={def.param.label}
      value={formatClock(cur)}
      onDec={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(cur - step)))}
      onInc={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(cur + step)))}
    />
  );
}

export default function GoalsScreen() {
  const a = useAnalysis();
  const goals = useStore((s) => s.goals);
  const setGoals = useStore((s) => s.setGoals);
  const toggleTag = useStore((s) => s.toggleTag);
  const input = useGoalInput(a);
  const summary = useGoalsSummary(a);

  if (!a || !input || !summary) {
    return (
      <Screen>
        <Empty icon="flag-checkered" title="Goals need some nights" body="Sync your watch or log a few nights, then pick goals to build streaks." />
      </Screen>
    );
  }

  const enabled = goals.filter((g) => g.enabled).length;
  const toggle = (id: GoalDef['id'], on: boolean) => setGoals(toggleGoal(goals, id, on, a.day, defaultGoalTarget(id, input)));
  const mine = summary.goals;
  const met = mine.filter((g) => g.today.status === 'met').length;
  const best = Math.max(0, ...mine.map((g) => g.currentStreak));
  const windDown = mine.find((g) => g.setting.id === 'wind-down' && g.today.status === 'pending');

  return (
    <Screen>
      {mine.length ? (
        <Hero
          label="Done today"
          value={`${met} of ${mine.length}`}
          caption={[summary.weeklyScore !== undefined ? `${summary.weeklyScore}% of goal-days met this week` : undefined, best ? `longest streak running: ${days(best)}` : undefined].filter(Boolean).join(' · ') || 'Streaks start with the first day you meet a goal.'}
        >
          {summary.weeklyScore !== undefined ? (
            <View style={{ marginTop: space.md }}>
              <Meter value={summary.weeklyScore} color={scoreColor(summary.weeklyScore)} />
            </View>
          ) : null}
        </Hero>
      ) : (
        <Hero label="Goals" value={`Pick up to ${MAX_GOALS}`} caption="A streak grows each day you meet a goal. Days without data don't break it; only a missed day does." />
      )}
      {windDown ? <Button kind="secondary" icon="weather-night" label="I wound down tonight" onPress={() => toggleTag(a.day, WIND_DOWN_TAG)} style={{ marginBottom: space.md }} /> : null}

      {mine.length ? (
        <Section title="Your goals">
          <ListCard>
            {mine.map((g) => {
              const st = GOAL_STATUS_TEXT[g.today.status];
              return (
                <Fold
                  bare
                  key={g.setting.id}
                  icon={st.icon}
                  title={g.def.title}
                  sub={g.today.status === 'pending' ? g.today.detail : [st.label, g.today.detail].filter(Boolean).join(' · ')}
                  value={g.currentStreak ? days(g.currentStreak) : undefined}
                >
                  <GoalDots days={g.days.slice(-14)} />
                  <View style={{ marginTop: space.sm }}>
                    <KeyValue label="Streak" value={days(g.currentStreak)} />
                    <KeyValue label="Best" sub="Last 60 days" value={days(g.bestStreak)} />
                    <KeyValue label="Last 7 days" value={`${g.weekMet} of ${g.weekKnown} met`} />
                    <GoalParam def={g.def} progress={g} />
                  </View>
                  <Text style={[font.tiny, { marginTop: space.sm }]}>{GOAL_LEGEND}</Text>
                </Fold>
              );
            })}
          </ListCard>
        </Section>
      ) : null}

      <Section title={`Choose · ${enabled} of ${MAX_GOALS}`}>
        <Card style={{ paddingVertical: space.xs }}>
          {GOAL_DEFS.map((def) => {
            const on = mine.some((g) => g.setting.id === def.id);
            return <Toggle key={def.id} label={def.title} sub={def.description} value={on} disabled={!on && enabled >= MAX_GOALS} onChange={(v) => toggle(def.id, v)} />;
          })}
        </Card>
        {enabled >= MAX_GOALS ? <Text style={[font.tiny, { paddingHorizontal: space.xs }]}>Up to {MAX_GOALS} goals at a time: switch one off to pick another.</Text> : null}
      </Section>
    </Screen>
  );
}
