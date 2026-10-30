import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Text, View } from 'react-native';

import {
  activeExperiment,
  computeExperimentResult,
  createExperiment,
  EXPERIMENT_METRICS,
  experimentQuestion,
  experimentRule,
  finishExperiment,
  MetricResult,
  reminderFor,
  Signal,
  templateFor,
} from '@/engine/experiments';
import { addDays, formatTime, localizeClockText } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { cycleAnswer, setAnswer } from '@/ui/coach/actions';
import { ExperimentDots, ExperimentLegend } from '@/ui/coach/Dots';
import { useExperimentData } from '@/ui/coach/hooks';
import { Button, Card, CardTitle, Empty, Icon, Note, Row, Screen, Section, Stat } from '@/ui/components';
import { confirm } from '@/ui/confirm';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

const SIGNAL_COLOR: Record<Signal, string> = {
  strong: colors.good,
  moderate: colors.accent,
  weak: colors.warn,
  none: colors.textDim,
  insufficient: colors.textFaint,
};

function MetricRow({ m, first }: { m: MetricResult; first: boolean }) {
  const color = m.signal === 'strong' || m.signal === 'moderate' ? (m.improved ? colors.good : colors.bad) : SIGNAL_COLOR[m.signal];
  const arrow = m.diff === undefined || m.signal === 'insufficient' ? 'minus' : m.diff > 0 ? 'arrow-up' : 'arrow-down';
  return (
    <View style={{ paddingVertical: space.sm, borderTopWidth: first ? 0 : 1, borderTopColor: colors.border }}>
      <Row gap={space.sm}>
        <Icon name={arrow} size={18} color={color} />
        <Text style={[font.body, { flex: 1 }]}>{m.label}</Text>
        <Text style={[font.small, { color: colors.text }]}>
          {m.baselineText ?? '–'} → <Text style={{ color, fontWeight: '700' }}>{m.experimentText ?? '–'}</Text>
        </Text>
      </Row>
      <Text style={[font.small, { marginLeft: 26, marginTop: 2 }]}>{m.verdict}</Text>
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
  const result = useMemo(() => (exp && data ? computeExperimentResult(exp, data) : undefined), [exp, data]);

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
  const recTone = rec?.kind === 'keep' ? 'good' : rec?.kind === 'no-effect' ? 'warn' : 'info';
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

  return (
    <Screen>
      <Stack.Screen options={{ title: localizeClockText(exp.title) }} />
      <Card accent={isActive ? colors.accentSoft : undefined}>
        <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={t?.icon ?? 'flask-outline'} size={24} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.tiny, { textTransform: 'uppercase' }]}>
              {isActive ? 'Running' : exp.status === 'completed' ? 'Finished' : 'Stopped'} · {exp.durationDays} nights
            </Text>
            <Text style={[font.h2, { marginTop: 2 }]}>{experimentRule(exp)}</Text>
            <Text style={[font.small, { marginTop: 4 }]}>
              {dayLabel(exp.startDate, a?.day)} → {dayLabel(lastDay, a?.day)}
            </Text>
          </View>
        </Row>
        {t ? <Text style={[font.small, { marginTop: space.md }]}>{t.why}</Text> : null}
        {t ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.md }}>
            {t.metrics.map((m) => (
              <View key={m} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surfaceAlt }}>
                <Text style={[font.tiny, { color: colors.textDim }]}>{EXPERIMENT_METRICS[m].label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {!a || !result ? (
        <Note tone="info">Sync some nights to see progress and results.</Note>
      ) : (
        <>
          {reminder ? (
            <Note tone="info" icon="bell-ring-outline">
              {`Today${reminder.at > a.now ? ` (reminder ${formatTime(reminder.at)})` : ''}: ${reminder.text}`}
            </Note>
          ) : null}

          {isActive && result.needsAnswer ? (
            <Card accent={colors.warn}>
              <Text style={[font.tiny, { textTransform: 'uppercase', color: colors.warn }]}>Quick check · {dayLabel(result.needsAnswer, a.day)}</Text>
              <Text style={[font.h3, { marginTop: 4 }]}>{experimentQuestion(exp)}</Text>
              <Row gap={space.sm} style={{ marginTop: space.md }}>
                <Button label="Yes" icon="check" onPress={() => setAnswer(exp, result.needsAnswer!, true)} />
                <Button kind="secondary" label="No" icon="close" onPress={() => setAnswer(exp, result.needsAnswer!, false)} />
              </Row>
            </Card>
          ) : null}

          <Section title="Progress">
            <Card>
              <ExperimentDots days={result.days} onPressDay={(d) => cycleAnswer(exp, d)} />
              <ExperimentLegend />
              <Row style={{ marginTop: space.md }}>
                <Stat label="Kept" value={`${result.kept}`} sub={`of ${result.elapsed} so far`} color={colors.good} />
                <Stat label="Adherence" value={result.adherencePct !== undefined ? `${Math.round(result.adherencePct * 100)}%` : '–'} sub={result.unknown ? `${result.unknown} unanswered` : undefined} />
                <Stat label={result.complete ? 'Status' : 'Left'} value={result.complete ? 'Done' : `${result.remaining}`} sub={result.complete ? undefined : 'nights'} />
              </Row>
              <Text style={[font.tiny, { marginTop: space.sm }]}>Tap a day to change its answer. Days are checked from your journal, caffeine log and watch where possible.</Text>
            </Card>
          </Section>

          <Section title={result.complete || !isActive ? 'Result' : 'Interim result'}>
            {rec ? (
              <Note tone={recTone} icon={rec.kind === 'keep' ? 'check-decagram-outline' : rec.kind === 'no-effect' ? 'scale-balance' : 'timer-sand'}>
                <Text style={{ fontWeight: '700' }}>{rec.title}. </Text>
                {rec.detail}
              </Note>
            ) : null}
            <Card>
              <CardTitle icon="chart-bell-curve-cumulative" title="Before → during" />
              {result.metrics.map((m, i) => (
                <MetricRow key={m.key} m={m} first={i === 0} />
              ))}
              <Text style={[font.tiny, { marginTop: space.sm }]}>
                {result.nightsAnalysed} night{result.nightsAnalysed === 1 ? '' : 's'} that followed the rule vs {result.baselineNights} nights in the 4 weeks before you started
                (Welch's t-test; only nights you stuck to it count). Wrist-based sleep stages are approximate.
              </Text>
            </Card>
          </Section>
        </>
      )}

      <View style={{ gap: space.sm, marginTop: space.lg }}>
        {isActive ? (
          <>
            <Button label={result?.complete ? 'Finish & save result' : 'Finish now'} icon="flag-checkered" onPress={finish} kind={result?.complete ? 'primary' : 'secondary'} />
            {rec?.kind === 'extend' || result?.complete ? <Button label="Extend by 7 nights" icon="calendar-arrow-right" kind="secondary" onPress={extend} /> : null}
            <Button label="Stop experiment" icon="stop-circle-outline" kind="danger" onPress={abandon} />
          </>
        ) : (
          <>
            {!otherActive ? <Button label="Run it again" icon="play-circle-outline" onPress={runAgain} /> : null}
            <Button label="Delete" icon="delete-outline" kind="danger" onPress={del} />
          </>
        )}
      </View>
    </Screen>
  );
}
