import { Switch, Text, View } from 'react-native';

import { defaultGoalTarget, GOAL_DEFS, GoalDef, GoalProgress, MAX_GOALS, setGoalTarget, toggleGoal } from '@/engine/goals';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { GOAL_STATUS_TEXT, GoalDots } from '@/ui/coach/Dots';
import { useGoalInput, useGoalsSummary } from '@/ui/coach/hooks';
import { Button, Card, Empty, Icon, Meter, Note, Row, Screen, Section, Stat, Stepper } from '@/ui/components';
import { colors, font, scoreColor, space } from '@/ui/theme';

function GoalParam({ def, progress }: { def: GoalDef; progress: GoalProgress }) {
  const goals = useStore((s) => s.goals);
  const setGoals = useStore((s) => s.setGoals);
  const profile = useStore((s) => s.profile);
  if (!def.param) return null;
  const id = def.id;
  const value = progress.setting.targetMin;
  if (id === 'in-bed-on-time') {
    // Optional: a fixed lights-out time instead of each night's plan.
    if (value === undefined) {
      return (
        <Row style={{ paddingVertical: space.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={font.body}>Lights-out</Text>
            <Text style={font.small}>Follows each night's plan</Text>
          </View>
          <Button small kind="secondary" label="Use a fixed time" onPress={() => setGoals(setGoalTarget(goals, id, 23 * 60))} />
        </Row>
      );
    }
    return (
      <View>
        <Stepper
          label="Fixed lights-out"
          value={formatClock(value)}
          onDec={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(value - def.param!.stepMin)))}
          onInc={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(value + def.param!.stepMin)))}
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
      onDec={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(cur - def.param!.stepMin)))}
      onInc={() => setGoals(setGoalTarget(goals, id, normalizeMinutes(cur + def.param!.stepMin)))}
    />
  );
}

export default function GoalsScreen() {
  const a = useAnalysis();
  const goals = useStore((s) => s.goals);
  const setGoals = useStore((s) => s.setGoals);
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

  return (
    <Screen subtitle="Small daily wins that add up">
      {summary.goals.length ? (
        <Card>
          <Row>
            <Stat label="This week" value={summary.weeklyScore !== undefined ? `${summary.weeklyScore}%` : '–'} color={summary.weeklyScore !== undefined ? scoreColor(summary.weeklyScore) : undefined} sub="of goal-days met" />
            <Stat label="Longest streak now" value={`${Math.max(0, ...summary.goals.map((g) => g.currentStreak))}`} sub="days" />
            <Stat label="Goals" value={`${summary.goals.length}/${MAX_GOALS}`} />
          </Row>
          {summary.weeklyScore !== undefined ? (
            <View style={{ marginTop: space.md }}>
              <Meter value={summary.weeklyScore} color={scoreColor(summary.weeklyScore)} />
            </View>
          ) : null}
        </Card>
      ) : (
        <Note tone="info" icon="flag-outline">
          Pick 1–{MAX_GOALS} goals. A streak grows each day you meet a goal; days without data don't break it, only a missed day does.
        </Note>
      )}

      <Section title="Goals">
        {GOAL_DEFS.map((def) => {
          const progress = summary.goals.find((g) => g.setting.id === def.id);
          const on = !!progress;
          const full = !on && enabled >= MAX_GOALS;
          const st = progress ? GOAL_STATUS_TEXT[progress.today.status] : undefined;
          return (
            <Card key={def.id} accent={on ? colors.accentSoft : undefined}>
              <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
                <Icon name={def.icon} size={22} color={on ? colors.accent : colors.textDim} />
                <View style={{ flex: 1 }}>
                  <Text style={font.h3}>{def.title}</Text>
                  <Text style={[font.small, { marginTop: 2 }]}>{def.description}</Text>
                </View>
                <Switch
                  value={on}
                  disabled={full}
                  onValueChange={(v) => toggle(def.id, v)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                  thumbColor={colors.text}
                  accessibilityLabel={`${def.title} goal`}
                />
              </Row>
              {progress && st ? (
                <View style={{ marginTop: space.md }}>
                  <Row>
                    <Stat label="Streak" value={`${progress.currentStreak}`} sub={progress.currentStreak === 1 ? 'day' : 'days'} color={progress.currentStreak ? colors.warn : undefined} />
                    <Stat label="Best" value={`${progress.bestStreak}`} sub="last 60 days" />
                    <Stat label="Last 7" value={`${progress.weekMet}/${progress.weekKnown}`} sub="met" />
                  </Row>
                  <View style={{ marginTop: space.md }}>
                    <GoalDots days={progress.days.slice(-14)} />
                  </View>
                  <Row gap={space.sm} style={{ marginTop: space.sm }}>
                    <Icon name={st.icon} size={16} color={st.color} />
                    <Text style={[font.small, { flex: 1 }]}>
                      Today: {progress.today.status === 'pending' ? progress.today.detail : `${st.label.toLowerCase()} — ${progress.today.detail ?? ''}`}
                    </Text>
                  </Row>
                  <View style={{ marginTop: space.sm }}>
                    <GoalParam def={def} progress={progress} />
                  </View>
                </View>
              ) : full ? (
                <Text style={[font.tiny, { marginTop: space.sm }]}>Up to {MAX_GOALS} goals at a time — switch one off to pick this.</Text>
              ) : null}
            </Card>
          );
        })}
      </Section>
      <Text style={[font.tiny, { textAlign: 'center', marginTop: space.sm }]}>
        Green = met · red = missed · hollow = no data · outlined purple = today, still to come.
      </Text>
    </Screen>
  );
}
