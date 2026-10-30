// Coach workstream cards placed on the Today and Coach screens. Each takes `{ analysis }`.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import type { Analysis } from '@/engine/analysis';
import { computeExperimentResult, experimentQuestion, experimentRule, templateFor } from '@/engine/experiments';
import { WIND_DOWN_TAG } from '@/engine/goals';
import { formatDuration, localizeClockText, weekdayOfKey } from '@/engine/time';
import { buildWeeklyReview, latestReviewWeek } from '@/engine/weeklyReview';
import { selectDataset, useStore } from '@/state/store';
import { setAnswer } from '@/ui/coach/actions';
import { ExperimentDots, GOAL_STATUS_TEXT, GoalDots } from '@/ui/coach/Dots';
import { useActiveExperiment, useExperimentData, useGoalsSummary, useSuggestions } from '@/ui/coach/hooks';
import { Button, Card, CardTitle, Icon, Row, Stat } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, scoreColor, space } from '@/ui/theme';

export const REVIEW_SEEN_MARK = 'weeklyReview.seen';

const Chevron = () => <Icon name="chevron-right" color={colors.textFaint} />;

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: color }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** The active experiment's progress; with `showEmpty`, a personalised suggestion to start one when none is running. */
export function ExperimentCard({ analysis: a, showEmpty }: { analysis: Analysis; showEmpty?: boolean }) {
  const exp = useActiveExperiment();
  const data = useExperimentData(a);
  const suggestions = useSuggestions(a);
  const result = useMemo(() => (exp && data ? computeExperimentResult(exp, data) : undefined), [exp, data]);

  if (!exp || !result) {
    const top = suggestions[0];
    if (!top || !showEmpty) return null;
    return (
      <Card onPress={() => router.push({ pathname: '/experiments', params: { template: top.template.id } })}>
        <CardTitle icon="flask-outline" title="Try an experiment" right={<Chevron />} />
        <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={top.template.icon} size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>{top.template.title}</Text>
            <Text style={[font.small, { marginTop: 2 }]}>{top.reason ? `Because: ${top.reason.charAt(0).toLowerCase()}${top.reason.slice(1)}.` : top.template.why}</Text>
            <Text style={[font.tiny, { marginTop: 6 }]}>{top.template.durationDays} NIGHTS · BEFORE/AFTER WITH YOUR OWN DATA</Text>
          </View>
        </Row>
      </Card>
    );
  }

  const t = templateFor(exp);
  const todayIdx = result.days.findIndex((d) => d.status === 'today' || d.date === a.day);
  const dayN = todayIdx >= 0 ? todayIdx + 1 : result.complete ? exp.durationDays : result.elapsed;
  const rec = result.recommendation;
  const recColor = rec.kind === 'keep' ? colors.good : rec.kind === 'no-effect' ? colors.warn : colors.accent;
  return (
    <Card onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: exp.id } })} accent={colors.accentSoft}>
      <CardTitle icon={t?.icon ?? 'flask-outline'} title={localizeClockText(exp.title)} right={<Text style={font.small}>{result.complete ? 'Done' : `Day ${dayN}/${exp.durationDays}`}</Text>} />
      <Text style={font.body}>{experimentRule(exp)}</Text>
      <View style={{ marginTop: space.md }}>
        <ExperimentDots days={result.days} size={exp.durationDays > 7 ? 18 : 24} />
      </View>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        <Pill label={rec.title} color={recColor} />
        <Text style={font.small}>
          kept {result.kept} of {result.elapsed}
          {result.nightsAnalysed ? ` · ${result.nightsAnalysed} night${result.nightsAnalysed === 1 ? '' : 's'} analysed` : ''}
        </Text>
      </Row>
      {result.needsAnswer && !result.complete ? (
        <View style={{ marginTop: space.md, padding: space.md, borderRadius: 12, backgroundColor: colors.surfaceAlt }}>
          <Text style={[font.tiny, { textTransform: 'uppercase' }]}>{dayLabel(result.needsAnswer, a.day)}</Text>
          <Text style={[font.body, { marginTop: 2 }]}>{experimentQuestion(exp)}</Text>
          <Row gap={space.sm} style={{ marginTop: space.sm }}>
            <Button small label="Yes" icon="check" onPress={() => setAnswer(exp, result.needsAnswer!, true)} />
            <Button small kind="secondary" label="No" icon="close" onPress={() => setAnswer(exp, result.needsAnswer!, false)} />
          </Row>
        </View>
      ) : result.complete ? (
        <Text style={[font.small, { marginTop: space.sm, color: colors.accent }]}>All nights are in — open to see your result.</Text>
      ) : null}
    </Card>
  );
}

/** Today's status for each enabled goal with current and best streaks; with `showEmpty`, a prompt to pick goals. */
export function GoalsCard({ analysis: a, showEmpty }: { analysis: Analysis; showEmpty?: boolean }) {
  const summary = useGoalsSummary(a);
  const toggleTag = useStore((s) => s.toggleTag);
  if (!summary) return null;
  if (!summary.goals.length) {
    if (!showEmpty) return null;
    return (
      <Card onPress={() => router.push('/goals')}>
        <CardTitle icon="flag-checkered" title="Goals & streaks" right={<Chevron />} />
        <Text style={font.small}>Pick 1–3 goals — a steady wake time, debt under 2h, a caffeine cut-off — and build streaks one day at a time.</Text>
        <View style={{ alignItems: 'flex-start', marginTop: space.md }}>
          <Button small label="Pick goals" icon="flag-outline" onPress={() => router.push('/goals')} />
        </View>
      </Card>
    );
  }
  return (
    <Card onPress={() => router.push('/goals')}>
      <CardTitle
        icon="flag-checkered"
        title="Goals & streaks"
        right={summary.weeklyScore !== undefined ? <Text style={[font.small, { color: scoreColor(summary.weeklyScore) }]}>{summary.weeklyScore}% this week</Text> : <Chevron />}
      />
      {summary.goals.map((g, i) => {
        const st = GOAL_STATUS_TEXT[g.today.status];
        const windDownPending = g.setting.id === 'wind-down' && g.today.status === 'pending';
        return (
          <View key={g.setting.id} style={{ paddingVertical: space.sm, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
            <Row gap={space.md}>
              <Icon name={st.icon} size={22} color={st.color} />
              <View style={{ flex: 1 }}>
                <Text style={font.body}>{g.def.title}</Text>
                <Text style={font.tiny}>{g.today.status === 'pending' ? g.today.detail : `${st.label} · ${g.today.detail ?? ''}`}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Row gap={3}>
                  <Icon name={g.currentStreak > 0 ? 'fire' : 'fire-off'} size={16} color={g.currentStreak > 0 ? colors.warn : colors.textFaint} />
                  <Text style={[font.h3, { color: g.currentStreak > 0 ? colors.text : colors.textFaint }]}>{g.currentStreak}</Text>
                </Row>
                <Text style={font.tiny}>best {g.bestStreak}</Text>
              </View>
            </Row>
            <View style={{ marginTop: 6, marginLeft: 34 }}>
              <GoalDots days={g.days.slice(-7)} size={11} labels={false} />
            </View>
            {windDownPending ? (
              <View style={{ alignItems: 'flex-start', marginTop: space.sm, marginLeft: 34 }}>
                <Button small kind="secondary" icon="weather-night" label="I wound down tonight" onPress={() => toggleTag(a.day, WIND_DOWN_TAG)} />
              </View>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

/**
 * Teaser for the latest weekly review. Shown on Sunday/Monday or while a new review is unseen;
 * `always` keeps it visible (Coach tab).
 */
export function WeeklyReviewCard({ analysis: a, always }: { analysis: Analysis; always?: boolean }) {
  const data = useStore(useShallow(selectDataset));
  const goals = useStore((s) => s.goals);
  const experiments = useStore((s) => s.experiments);
  const seen = useStore((s) => s.settings.marks[REVIEW_SEEN_MARK]);
  const week = latestReviewWeek(a.day);
  const review = useMemo(() => buildWeeklyReview({ analysis: a, data, goals, experiments, weekStart: week }), [a, data, goals, experiments, week]);
  const wd = weekdayOfKey(a.day);
  const isNew = seen !== week;
  if (!always && !(wd === 0 || wd === 1 || isNew)) return null;
  if (review.nightsRecorded < 3) {
    if (!always) return null;
    return (
      <Card>
        <CardTitle icon="calendar-week" title="Weekly review" />
        <Text style={font.small}>Your first review arrives on Sunday evening once a few nights are recorded.</Text>
      </Card>
    );
  }
  const debt = review.debtChangeMin;
  return (
    <Card onPress={() => router.push({ pathname: '/review', params: { week } })} accent={isNew ? colors.accent : undefined}>
      <CardTitle icon="calendar-week" title={`Your week · ${review.label}`} right={isNew ? <Pill label="NEW" color={colors.accent} /> : <Chevron />} />
      <Row>
        <Stat label="Avg sleep" value={review.avgSleepMin !== undefined ? formatDuration(review.avgSleepMin) : '–'} sub={`need ${formatDuration(review.needMin)}`} />
        <Stat
          label="Avg score"
          value={review.avgScore !== undefined ? String(Math.round(review.avgScore)) : '–'}
          color={review.avgScore !== undefined ? scoreColor(review.avgScore) : undefined}
          sub={review.prevAvgScore !== undefined && review.avgScore !== undefined ? `${review.avgScore >= review.prevAvgScore ? '▲' : '▼'} ${Math.abs(Math.round(review.avgScore - review.prevAvgScore))} vs last wk` : undefined}
        />
        <Stat label="Debt" value={`${debt >= 0 ? '+' : '−'}${formatDuration(Math.abs(debt))}`} color={debt > 15 ? colors.warn : debt < -15 ? colors.good : colors.text} sub="over the week" />
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.md, alignItems: 'flex-start' }}>
        <Icon name={review.focus.icon} size={18} color={colors.accent} />
        <Text style={[font.small, { flex: 1, color: colors.text }]}>
          <Text style={{ fontWeight: '700' }}>Next week: </Text>
          {review.focus.title}
        </Text>
      </Row>
    </Card>
  );
}

/** Gentle, non-diagnostic warning when resting HR, HRV and breathing rate drift from baseline. */
export function RecoveryAlertCard({ analysis: a }: { analysis: Analysis }) {
  const alert = a.recoveryAlert;
  if (!alert) return null;
  const tone = alert.level === 'warning' ? colors.bad : colors.warn;
  return (
    <Card accent={tone}>
      <CardTitle icon="heart-pulse" title={alert.title} color={tone} right={<Pill label={alert.level === 'warning' ? 'TAKE IT EASY' : 'WATCH'} color={tone} />} />
      <Text style={font.small}>{alert.detail}</Text>
      {alert.signals?.length ? (
        <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
          {alert.signals.map((s) => (
            <View
              key={s.key}
              style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: s.off ? tone : colors.border }}
            >
              <Text style={[font.tiny, { textTransform: 'uppercase' }]}>{s.label}</Text>
              <Text style={[font.h3, { color: s.off ? tone : colors.text }]}>{s.change}</Text>
              <Text style={font.tiny}>
                usual {s.key === 'resp' ? s.baseline.toFixed(1) : Math.round(s.baseline)}
                {s.key === 'hr' ? ' bpm' : s.key === 'hrv' ? ' ms' : '/min'}
              </Text>
            </View>
          ))}
        </Row>
      ) : null}
      {alert.advice?.length ? (
        <View style={{ marginTop: space.md, gap: 4 }}>
          {alert.advice.map((t) => (
            <Row key={t} gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <Text style={[font.small, { color: tone }]}>•</Text>
              <Text style={[font.small, { flex: 1 }]}>{t}</Text>
            </Row>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
