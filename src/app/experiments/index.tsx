import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { defaultTargetMin, EXPERIMENT_METRICS, ExperimentTemplate, fillTarget, TEMPLATE_BY_ID, TemplateSuggestion } from '@/engine/experiments';
import type { Analysis } from '@/engine/analysis';
import { formatClock, localizeClockText, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { ExperimentCard } from '@/ui/cards/CoachCards';
import { demoBackdateDays, startExperiment } from '@/ui/coach/actions';
import { useActiveExperiment, useSuggestions } from '@/ui/coach/hooks';
import { Button, Card, Empty, Icon, ListRow, Note, Row, Screen, Section, Stepper } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

const OUTCOME: Record<string, { label: string; color: string }> = {
  keep: { label: 'Keep it', color: colors.good },
  extend: { label: 'Inconclusive', color: colors.accent },
  'no-effect': { label: 'No effect', color: colors.warn },
  'too-early': { label: 'Too early', color: colors.textDim },
};

function MetricChips({ t }: { t: ExperimentTemplate }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {t.metrics.map((m) => (
        <View key={m} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surfaceAlt }}>
          <Text style={[font.tiny, { color: colors.textDim }]}>{EXPERIMENT_METRICS[m].label}</Text>
        </View>
      ))}
    </View>
  );
}

function TemplateCard({ s, a, open, onToggle, blocked }: { s: TemplateSuggestion; a: Analysis; open: boolean; onToggle: () => void; blocked: boolean }) {
  const t = s.template;
  const demo = useStore((st) => st.settings.dataMode === 'demo');
  const profile = useStore((st) => st.profile);
  const [target, setTarget] = useState<number | undefined>(() => defaultTargetMin(t, { ...a, profile }));
  const start = (backdateDays?: number) => {
    const e = startExperiment(t, a, { targetMin: target, backdateDays });
    router.push({ pathname: '/experiments/[id]', params: { id: e.id } });
  };
  return (
    <Card onPress={onToggle} accent={open ? colors.accent : undefined}>
      <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
        <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={t.icon} size={20} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={font.h3}>{t.title}</Text>
          <Text style={[font.small, { marginTop: 2 }]}>{fillTarget(t.rule, target)}</Text>
          {s.reason ? (
            <Row gap={5} style={{ marginTop: 6, alignItems: 'flex-start' }}>
              <Icon name="lightbulb-on-outline" size={14} color={colors.energy} />
              <Text style={[font.tiny, { flex: 1, color: colors.energy }]}>{s.reason}</Text>
            </Row>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={font.tiny}>{t.durationDays} nights</Text>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} />
        </View>
      </Row>
      {open ? (
        <View style={{ marginTop: space.md, gap: space.md }}>
          <Text style={font.body}>{t.why}</Text>
          <View>
            <Text style={[font.tiny, { marginBottom: 6 }]}>WHAT EEPY MEASURES</Text>
            <MetricChips t={t} />
          </View>
          {target !== undefined ? (
            <Stepper
              label={t.adherence.kind === 'wake-window' ? 'Wake-up target' : 'Lights out by'}
              sub="Based on your usual timing"
              value={formatClock(target)}
              onDec={() => setTarget(normalizeMinutes(target - 15))}
              onInc={() => setTarget(normalizeMinutes(target + 15))}
            />
          ) : null}
          <Text style={font.small}>
            {t.askByDefault
              ? "eepy reads your journal tags where it can and otherwise asks a quick yes/no each morning."
              : 'eepy checks this from your watch and logs automatically — no daily questions unless data is missing.'}{' '}
            Results compare the nights you stick to it with the 4 weeks before you started.
          </Text>
          {blocked ? (
            <Note tone="info">One experiment at a time keeps the results clean — finish or stop your current one first.</Note>
          ) : (
            <View style={{ gap: space.sm }}>
              <Button label="Start tonight" icon="play-circle-outline" onPress={() => start()} />
              {demo ? (
                <Button kind="ghost" small label={`Demo: pretend I started ${demoBackdateDays(t)} days ago`} icon="history" onPress={() => start(demoBackdateDays(t))} />
              ) : null}
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

export default function ExperimentsScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ template?: string }>();
  const experiments = useStore((s) => s.experiments);
  const active = useActiveExperiment();
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
    <Screen subtitle="Change one thing, see what it does to your sleep">
      {active ? (
        <Section title="Running now">
          <ExperimentCard analysis={a} />
        </Section>
      ) : (
        <Card>
          <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
            <Icon name="flask-outline" size={26} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={font.h3}>How experiments work</Text>
              <Text style={[font.small, { marginTop: 4 }]}>
                Pick one rule and keep it for 7 or 14 nights. eepy tracks whether you stuck to it, then compares those nights with your previous 4 weeks using the same
                statistics as your insights — so you learn what works for you, not the average person.
              </Text>
            </View>
          </Row>
        </Card>
      )}

      <Section title="Suggested for you">
        {ordered.map((s) => (
          <TemplateCard
            key={s.template.id}
            s={s}
            a={a}
            open={openId === s.template.id}
            onToggle={() => setOpenId(openId === s.template.id ? undefined : s.template.id)}
            blocked={!!active}
          />
        ))}
      </Section>

      {history.length ? (
        <Section title="History">
          <Card>
            {history.map((e) => {
              const o = e.status === 'abandoned' ? { label: 'Stopped', color: colors.textFaint } : OUTCOME[e.outcome?.kind ?? 'too-early'];
              return (
                <ListRow
                  key={e.id}
                  icon={TEMPLATE_BY_ID[e.templateId]?.icon ?? 'flask-outline'}
                  title={localizeClockText(e.title)}
                  sub={`${dayLabel(e.startDate, a.day)} · ${e.outcome ? `${e.outcome.nights} nights · ` : ''}${e.outcome?.adherencePct !== undefined ? `${Math.round(e.outcome.adherencePct * 100)}% kept` : e.status}`}
                  right={
                    <Row gap={6}>
                      <Text style={{ color: o.color, fontSize: 12, fontWeight: '700' }}>{o.label}</Text>
                      <Icon name="chevron-right" color={colors.textFaint} />
                    </Row>
                  }
                  onPress={() => router.push({ pathname: '/experiments/[id]', params: { id: e.id } })}
                />
              );
            })}
          </Card>
        </Section>
      ) : null}
      <Pressable onPress={() => router.push('/journal')} style={{ marginTop: space.md }}>
        <Text style={[font.tiny, { textAlign: 'center' }]}>Tip: journal tags (alcohol, screens, reading, morning sunlight…) let eepy check experiments without asking you.</Text>
      </Pressable>
    </Screen>
  );
}
