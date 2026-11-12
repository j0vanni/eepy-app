/**
 * Experiments: change one thing for a week or two and see what it does to your sleep. Opens with
 * the experiment that is running (or, with none, what an experiment is); then the ones suggested
 * for you as rows that open in place to set up and start; then the ones you have finished.
 *
 * Param `template`: that experiment comes first and is open.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { defaultTargetMin, EXPERIMENT_METRICS, fillTarget, TEMPLATE_BY_ID, TemplateSuggestion } from '@/engine/experiments';
import { formatClock, localizeClockText, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { demoBackdateDays, startExperiment } from '@/ui/coach/actions';
import { useActiveExperiment, useExperimentResult, useSuggestions } from '@/ui/coach/hooks';
import { ExperimentHero, ExperimentQuestion } from '@/ui/coach/parts';
import { Button, Empty, Fold, Hero, Icon, ListCard, ListRow, Row, Screen, Section, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

const OUTCOME: Record<string, { label: string; color: string }> = {
  keep: { label: 'Keep it', color: colors.good },
  extend: { label: 'Unclear', color: colors.textDim },
  'no-effect': { label: 'No effect', color: colors.warn },
  'too-early': { label: 'Too early', color: colors.textDim },
};

/** One suggested experiment: a row that opens to its reason, its setting and Start. */
function TemplateRow({ s, a, open, onToggle, blocked }: { s: TemplateSuggestion; a: Analysis; open: boolean; onToggle: () => void; blocked: boolean }) {
  const t = s.template;
  const demo = useStore((st) => st.settings.dataMode === 'demo');
  const profile = useStore((st) => st.profile);
  const [target, setTarget] = useState<number | undefined>(() => defaultTargetMin(t, { ...a, profile }));
  const start = (backdateDays?: number) => {
    const e = startExperiment(t, a, { targetMin: target, backdateDays });
    router.push({ pathname: '/experiments/[id]', params: { id: e.id } });
  };
  return (
    <Fold bare icon={t.icon} title={t.title} sub={s.reason ?? fillTarget(t.rule, target)} value={`${t.durationDays} nights`} open={open} onToggle={onToggle}>
      <View style={{ gap: space.md }}>
        {s.reason ? <Text style={font.body}>{fillTarget(t.rule, target)}.</Text> : null}
        <Text style={font.small}>{t.why}</Text>
        {target !== undefined ? (
          <Stepper
            label={t.adherence.kind === 'wake-window' ? 'Wake-up target' : 'Lights out by'}
            sub="From your usual timing"
            value={formatClock(target)}
            onDec={() => setTarget(normalizeMinutes(target - 15))}
            onInc={() => setTarget(normalizeMinutes(target + 15))}
          />
        ) : null}
        <Text style={font.small}>
          {t.askByDefault ? 'eepy reads your journal tags where it can, and otherwise asks a quick yes or no each morning.' : 'eepy checks this from your watch. No daily questions unless data is missing.'} It measures{' '}
          {t.metrics.map((m) => EXPERIMENT_METRICS[m].label.toLowerCase()).join(', ')}.
        </Text>
        {blocked ? (
          <Text style={font.small}>One experiment at a time keeps the result clean. Finish or stop the one you are running first.</Text>
        ) : (
          <View style={{ gap: space.sm }}>
            <Button label="Start tonight" icon="play-circle-outline" onPress={() => start()} />
            {demo ? <Button kind="ghost" small label={`Demo: pretend I started ${demoBackdateDays(t)} days ago`} icon="history" onPress={() => start(demoBackdateDays(t))} /> : null}
          </View>
        )}
      </View>
    </Fold>
  );
}

export default function ExperimentsScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ template?: string }>();
  const experiments = useStore((s) => s.experiments);
  const active = useActiveExperiment();
  const result = useExperimentResult(a, active);
  const suggestions = useSuggestions(a);
  const [openId, setOpenId] = useState<string | undefined>(() => (params.template && TEMPLATE_BY_ID[params.template] ? params.template : undefined));

  if (!a) {
    return (
      <Screen>
        <Empty icon="flask-outline" title="Experiments need a few nights" body="eepy compares the nights you try something new with how you slept before. Sync a week or two of sleep first." />
      </Screen>
    );
  }

  // Bring a template that was linked to (e.g. from a tip or the weekly review) to the top.
  const pinned = params.template;
  const ordered = pinned ? [...suggestions.filter((s) => s.template.id === pinned), ...suggestions.filter((s) => s.template.id !== pinned)] : suggestions;
  const history = experiments.filter((e) => e.status !== 'active').sort((x, y) => (y.finishedAt ?? y.createdAt) - (x.finishedAt ?? x.createdAt));

  return (
    <Screen>
      {active && result ? (
        <>
          <ExperimentHero a={a} exp={active} result={result} link />
          {result.needsAnswer && !result.complete ? <ExperimentQuestion exp={active} date={result.needsAnswer} today={a.day} /> : null}
        </>
      ) : (
        <Hero label="Experiments" value="Change one thing" caption="Keep one rule for 7 or 14 nights. eepy then compares those nights with the four weeks before, so you learn what works for you." />
      )}

      <Section title={active ? 'Up next' : 'Suggested for you'}>
        <ListCard>
          {ordered.map((s) => (
            <TemplateRow key={s.template.id} s={s} a={a} open={openId === s.template.id} onToggle={() => setOpenId(openId === s.template.id ? undefined : s.template.id)} blocked={!!active} />
          ))}
        </ListCard>
      </Section>

      {history.length ? (
        <Section title="Finished">
          <ListCard>
            {history.map((e) => {
              const o = e.status === 'abandoned' ? { label: 'Stopped', color: colors.textFaint } : OUTCOME[e.outcome?.kind ?? 'too-early'];
              return (
                <ListRow
                  key={e.id}
                  icon={TEMPLATE_BY_ID[e.templateId]?.icon ?? 'flask-outline'}
                  title={localizeClockText(e.title)}
                  sub={`${dayLabel(e.startDate, a.day)} · ${e.outcome ? `${e.outcome.nights} nights · ` : ''}${e.outcome?.adherencePct !== undefined ? `${Math.round(e.outcome.adherencePct * 100)}% kept` : e.status}`}
                  right={
                    <Row gap={space.xs}>
                      <Text style={[font.small, { color: o.color, fontWeight: '700' }]}>{o.label}</Text>
                      <Icon name="chevron-right" color={colors.textFaint} />
                    </Row>
                  }
                  onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: e.id } })}
                />
              );
            })}
          </ListCard>
        </Section>
      ) : null}

      <Section title="Good to know">
        <ListCard>
          <ListRow icon="notebook-edit-outline" title="Tag your days in the journal" sub="Alcohol, screens, reading, morning light: then eepy can check an experiment without asking you" onPress={() => router.push('/journal')} />
          <Fold bare icon="school-outline" title="How the result is worked out">
            <Text style={font.small}>
              eepy tracks whether you kept to the rule each day, then compares the nights you did with your previous four weeks, using the same statistics as your insights. Only nights you stuck to it
              count, and wrist-based sleep stages are approximate.
            </Text>
          </Fold>
        </ListCard>
      </Section>
    </Screen>
  );
}
