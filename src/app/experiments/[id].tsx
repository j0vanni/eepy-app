/**
 * One experiment. Running: which day it is and the rule, the morning yes/no if eepy can't tell, the
 * days so far (tap one to change its answer) and the result so far. Finished: the verdict, then the
 * before and after. Finishing, extending, stopping and deleting are rows at the end.
 */
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { activeExperiment, createExperiment, EXPERIMENT_METRICS, experimentRule, finishExperiment, MetricResult, reminderFor, templateFor } from '@/engine/experiments';
import { addDays, formatTime, localizeClockText } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { cycleAnswer } from '@/ui/coach/actions';
import { ExperimentDots, ExperimentLegend } from '@/ui/coach/Dots';
import { useExperimentData, useExperimentResult } from '@/ui/coach/hooks';
import { experimentDay, ExperimentQuestion } from '@/ui/coach/parts';
import { Banner, Button, Card, Empty, Fold, Hero, Icon, ListCard, ListRow, Row, Screen, Section, Stat } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

/** One measure: before → during, and what that amounts to. */
function MetricRow({ m }: { m: MetricResult }) {
  const clear = m.signal === 'strong' || m.signal === 'moderate';
  const color = clear ? (m.improved ? colors.good : colors.bad) : colors.text;
  const arrow = m.diff === undefined || m.signal === 'insufficient' ? 'minus' : m.diff > 0 ? 'arrow-up' : 'arrow-down';
  return (
    <View style={{ paddingVertical: space.md }}>
      <Row gap={space.sm}>
        <Icon name={arrow} size={18} color={clear ? color : colors.textFaint} />
        <Text style={[font.body, { flex: 1 }]}>{m.label}</Text>
        <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>
          {m.baselineText ?? '–'} → <Text style={{ color, fontWeight: '700' }}>{m.experimentText ?? '–'}</Text>
        </Text>
      </Row>
      <Text style={[font.small, { marginLeft: 26, marginTop: space.xxs }]}>{m.verdict}</Text>
    </View>
  );
}

export default function ExperimentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useAnalysis();
  const experiments = useStore((s) => s.experiments);
  const upsert = useStore((s) => s.upsertExperiment);
  const remove = useStore((s) => s.removeExperiment);
  const exp = experiments.find((e) => e.id === id);
  const data = useExperimentData(a);
  const result = useExperimentResult(a, exp);

  if (!exp) {
    return (
      <Screen>
        <Empty icon="flask-outline" title="Experiment not found" body="It may have been deleted.">
          <Button label="All experiments" onPress={() => router.replace('/experiments')} />
        </Empty>
      </Screen>
    );
  }
  const t = templateFor(exp);
  const lastDay = addDays(exp.startDate, exp.durationDays - 1);
  const isActive = exp.status === 'active';
  const rec = result?.recommendation;
  const reminder = a && isActive && a.day >= exp.startDate && a.day <= lastDay ? reminderFor(exp, a.day, { bedtime: a.tonight.bedtime, wake: a.wakeTime }) : undefined;

  const finish = async () => {
    if (!data) return;
    const early = result && !result.complete;
    if (early && !(await confirm('Finish early?', `${result.remaining} night${result.remaining === 1 ? '' : 's'} are left. The result will be based on the nights so far.`, 'Finish'))) return;
    upsert(finishExperiment(exp, data, Date.now(), 'completed'));
  };
  const abandon = async () => {
    if (!data || !(await confirm('Stop this experiment?', 'It moves to your history as stopped. You can run it again any time.', 'Stop', true))) return;
    upsert(finishExperiment(exp, data, Date.now(), 'abandoned'));
  };
  const extend = () => upsert({ ...exp, durationDays: exp.durationDays + 7, status: 'active', finishedAt: undefined, outcome: undefined });
  const runAgain = () => {
    if (!t || !a) return;
    const e = createExperiment(t, { startDate: a.day, now: Date.now(), targetMin: exp.targetMin });
    upsert(e);
    router.replace({ pathname: '/experiments/[id]', params: { id: e.id } });
  };
  const del = async () => {
    if (!(await confirm('Delete experiment?', 'This removes it and its answers from your history.', 'Delete', true))) return;
    remove(exp.id);
    router.back();
  };
  const otherActive = activeExperiment(experiments.filter((e) => e.id !== exp.id));
  const asking = !!a && !!result && isActive && !!result.needsAnswer;
  const dates = `${dayLabel(exp.startDate, a?.day)} to ${dayLabel(lastDay, a?.day)}`;
  const recColor = rec?.kind === 'keep' ? colors.good : rec?.kind === 'no-effect' ? colors.warn : colors.text;

  return (
    <Screen>
      <Stack.Screen options={{ title: localizeClockText(exp.title) }} />

      {isActive ? (
        <Hero
          label={`Running · ${exp.durationDays} nights`}
          value={!a || !result ? 'Running' : result.complete ? 'All nights in' : `Day ${experimentDay(exp, result, a.day)} of ${exp.durationDays}`}
          caption={`${experimentRule(exp)}. ${dates}.`}
        />
      ) : (
        <Hero
          label={`${exp.status === 'completed' ? 'Finished' : 'Stopped'} · ${exp.durationDays} nights`}
          value={rec?.title ?? (exp.status === 'completed' ? 'Finished' : 'Stopped')}
          color={recColor}
          caption={`${experimentRule(exp)}. ${dates}.`}
        />
      )}

      {a && result && reminder ? <Banner icon="bell-ring-outline" text={`Today${reminder.at > a.now ? `, reminder at ${formatTime(reminder.at)}` : ''}: ${reminder.text}`} /> : null}

      {asking ? <ExperimentQuestion exp={exp} date={result.needsAnswer!} today={a.day} /> : null}
      {isActive && result?.complete ? <Button label="Finish and save the result" icon="flag-checkered" kind={asking ? 'secondary' : 'primary'} onPress={finish} style={{ marginBottom: space.md }} /> : null}
      {!isActive && !otherActive ? <Button label="Run it again" icon="play-circle-outline" onPress={runAgain} style={{ marginBottom: space.md }} /> : null}

      {!a || !result ? (
        <Banner text="Sync some nights to see progress and results." />
      ) : (
        <>
          <Section title="Day by day">
            <Card>
              <ExperimentDots days={result.days} onPressDay={(d) => cycleAnswer(exp, d)} />
              <ExperimentLegend />
              <Row style={{ marginTop: space.lg }}>
                <Stat label="Kept" value={String(result.kept)} sub={`of ${result.elapsed} so far`} />
                <Stat label="Kept to it" value={result.adherencePct !== undefined ? `${Math.round(result.adherencePct * 100)}%` : '–'} sub={result.unknown ? `${result.unknown} unanswered` : undefined} />
                <Stat label={result.complete ? 'Status' : 'Left'} value={result.complete ? 'Done' : String(result.remaining)} sub={result.complete ? undefined : 'nights'} />
              </Row>
              <Text style={[font.tiny, { marginTop: space.md }]}>Tap a day to change its answer. eepy fills them in from your journal, caffeine log and watch where it can.</Text>
            </Card>
          </Section>

          <Section title={result.complete || !isActive ? 'Before and after' : 'Before and after, so far'}>
            <Card style={{ paddingVertical: space.xs }}>
              {rec ? (
                <View style={{ paddingVertical: space.md }}>
                  <Text style={[font.h3, { color: recColor }]}>{rec.title}</Text>
                  <Text style={[font.small, { marginTop: space.xxs }]}>{rec.detail}</Text>
                </View>
              ) : null}
              {result.metrics.map((m) => (
                <MetricRow key={m.key} m={m} />
              ))}
              <Fold bare title="How this is measured">
                <Text style={font.small}>
                  {result.nightsAnalysed} night{result.nightsAnalysed === 1 ? '' : 's'} that followed the rule, against {result.baselineNights} nights in the four weeks before you started (Welch's t-test; only
                  nights you stuck to it count). Wrist-based sleep stages are approximate.
                </Text>
              </Fold>
            </Card>
          </Section>
        </>
      )}

      <Section title="This experiment">
        <ListCard>
          {t ? (
            <Fold bare icon={t.icon} title="Why try it" sub={`Measures ${t.metrics.map((m) => EXPERIMENT_METRICS[m].label.toLowerCase()).join(', ')}`}>
              <Text style={font.small}>{t.why}</Text>
            </Fold>
          ) : null}
          {isActive && !result?.complete ? <ListRow icon="flag-checkered" title="Finish now" sub="Save the result from the nights so far" onPress={finish} /> : null}
          {isActive && (rec?.kind === 'extend' || result?.complete) ? <ListRow icon="calendar-arrow-right" title="Extend by 7 nights" onPress={extend} /> : null}
          {isActive ? <ListRow icon="stop-circle-outline" iconColor={colors.bad} title="Stop experiment" sub="It moves to your history as stopped" onPress={abandon} /> : null}
          {!isActive ? <ListRow icon="delete-outline" iconColor={colors.bad} title="Delete" sub="Removes it and its answers" onPress={del} /> : null}
        </ListCard>
      </Section>
    </Screen>
  );
}
