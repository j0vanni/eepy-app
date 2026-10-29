import { Href, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { TEMPLATE_BY_ID } from '@/engine/experiments';
import { useAnalysis } from '@/state/useAnalysis';
import { ExperimentCard, GoalsCard, RecoveryAlertCard, WeeklyReviewCard } from '@/ui/cards/CoachCards';
import { useActiveExperiment, useSuggestions } from '@/ui/coach/hooks';
import { Button, Card, Empty, Icon, Row, Screen, Section } from '@/ui/components';
import { greeting } from '@/ui/format';
import { colors, font, radius, space } from '@/ui/theme';

interface Tool {
  href: Href;
  icon: string;
  title: string;
  sub: string;
  color: string;
}

const TOOLS: Tool[] = [
  { href: '/experiments', icon: 'flask-outline', title: 'Experiments', sub: 'Test what changes your sleep', color: colors.accent },
  { href: '/goals', icon: 'flag-checkered', title: 'Goals', sub: 'Streaks, one day at a time', color: colors.good },
  { href: '/review', icon: 'calendar-week', title: 'Weekly review', sub: 'Your week in sleep', color: colors.info },
  { href: '/learning', icon: 'clock-time-four-outline', title: 'Body clock', sub: 'Teach eepy your rhythm', color: colors.energy },
  { href: '/simulate', icon: 'tune-variant', title: 'What if?', sub: 'Play with tomorrow', color: colors.rem },
  { href: '/winddown', icon: 'weather-night', title: 'Wind down', sub: 'Breathing & sounds', color: colors.light },
  { href: '/cbti', icon: 'account-heart-outline', title: 'Insomnia programme', sub: '6-week CBT-I', color: colors.bad },
  { href: '/journal', icon: 'notebook-outline', title: 'Journal', sub: 'Tags, ratings, caffeine', color: colors.warn },
  { href: '/need', icon: 'battery-charging-high', title: 'Sleep need', sub: 'How much you really need', color: colors.good },
  { href: '/jetlag', icon: 'airplane-clock', title: 'Jet lag', sub: 'Plan a time-zone shift', color: colors.info },
  { href: '/export', icon: 'export-variant', title: 'Reports & export', sub: 'PDF for your doctor, CSV', color: colors.textDim },
];

function ToolTile({ t }: { t: Tool }) {
  return (
    <Pressable
      onPress={() => router.push(t.href)}
      accessibilityRole="button"
      accessibilityLabel={t.title}
      style={({ pressed }) => ({
        width: '48.5%',
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        padding: space.md,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={t.icon} size={19} color={t.color} />
      </View>
      <Text style={[font.h3, { marginTop: space.sm, fontSize: 15 }]} numberOfLines={1}>
        {t.title}
      </Text>
      <Text style={[font.tiny, { marginTop: 2 }]} numberOfLines={2}>
        {t.sub}
      </Text>
    </Pressable>
  );
}

export default function CoachScreen() {
  const a = useAnalysis();
  const active = useActiveExperiment();
  const suggestions = useSuggestions(a);
  const upNext = active ? suggestions.slice(0, 2) : suggestions.slice(1, 3);
  const testableTips = a ? a.tips.filter((t) => t.experimentId && TEMPLATE_BY_ID[t.experimentId] && t.experimentId !== active?.templateId).slice(0, 2) : [];

  return (
    <Screen title="Coach" subtitle={a ? `${greeting(a.now)} — let's make tonight a little better` : 'Experiments, goals and your week in sleep'}>
      {a ? (
        <>
          <RecoveryAlertCard analysis={a} />

          <Section title={active ? 'Your experiment' : 'Experiment of the week'} action={<Button small kind="ghost" label="All" onPress={() => router.push('/experiments')} />}>
            <ExperimentCard analysis={a} showEmpty />
          </Section>

          <Section title="Goals & streaks" action={<Button small kind="ghost" label="Edit" onPress={() => router.push('/goals')} />}>
            <GoalsCard analysis={a} showEmpty />
          </Section>

          <Section title="This week">
            <WeeklyReviewCard analysis={a} always />
          </Section>

          {upNext.length ? (
            <Section title={active ? 'Up next' : 'More to try'}>
              {upNext.map((s) => (
                <Card key={s.template.id} onPress={() => router.push({ pathname: '/experiments', params: { template: s.template.id } })}>
                  <Row gap={space.md}>
                    <Icon name={s.template.icon} size={22} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={font.h3}>{s.template.title}</Text>
                      <Text style={font.small} numberOfLines={2}>
                        {s.reason ?? s.template.rule}
                      </Text>
                    </View>
                    <Text style={font.tiny}>{s.template.durationDays} nights</Text>
                  </Row>
                </Card>
              ))}
            </Section>
          ) : null}

          {testableTips.length ? (
            <Section title="Advice you can test">
              {testableTips.map((t) => (
                <Card key={t.id}>
                  <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
                    <Icon name={t.icon} size={20} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={font.h3}>{t.title}</Text>
                      <Text style={[font.small, { marginTop: 2 }]} numberOfLines={3}>
                        {t.detail}
                      </Text>
                      <View style={{ alignItems: 'flex-start', marginTop: space.sm }}>
                        <Button
                          small
                          kind="secondary"
                          icon="flask-outline"
                          label={`Test it: ${TEMPLATE_BY_ID[t.experimentId!].title.toLowerCase()}`}
                          onPress={() => router.push({ pathname: '/experiments', params: { template: t.experimentId! } })}
                        />
                      </View>
                    </View>
                  </Row>
                </Card>
              ))}
            </Section>
          ) : null}
        </>
      ) : (
        <Empty
          icon="account-heart-outline"
          title="Your sleep coach"
          body="Once a few nights are in, this is where you run experiments, build streaks and get a weekly review of your sleep."
        >
          <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
        </Empty>
      )}

      <Section title="Tools">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.sm }}>
          {TOOLS.map((t) => (
            <ToolTile key={t.title} t={t} />
          ))}
        </View>
      </Section>
    </Screen>
  );
}
