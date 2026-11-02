// Coach: your experiment, goals & streaks, this week's review and what to try next (More → Coach).
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { TEMPLATE_BY_ID } from '@/engine/experiments';
import { useAnalysis } from '@/state/useAnalysis';
import { ExperimentCard, GoalsCard, RecoveryAlertCard, WeeklyReviewCard } from '@/ui/cards/CoachCards';
import { useActiveExperiment, useSuggestions } from '@/ui/coach/hooks';
import { Button, Card, Empty, Icon, Row, Screen, Section } from '@/ui/components';
import { greeting } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

export default function CoachScreen() {
  const a = useAnalysis();
  const active = useActiveExperiment();
  const suggestions = useSuggestions(a);
  const upNext = active ? suggestions.slice(0, 2) : suggestions.slice(1, 3);
  const testableTips = a ? a.tips.filter((t) => t.experimentId && TEMPLATE_BY_ID[t.experimentId] && t.experimentId !== active?.templateId).slice(0, 2) : [];

  return (
    <Screen subtitle={a ? `${greeting(a.now)} — let's make tonight a little better` : 'Experiments, goals and your week in sleep'}>
      {a ? (
        <>
          <RecoveryAlertCard analysis={a} />

          <Section title={active ? 'Your experiment' : 'Experiment of the week'} action={<Button small kind="ghost" label="See all" onPress={() => router.push('/experiments')} />}>
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
                      <Text style={[font.small, { marginTop: 2 }]}>{t.detail}</Text>
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

      <Card onPress={() => router.navigate('/more')}>
        <Row gap={space.md}>
          <Icon name="dots-horizontal-circle-outline" size={22} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={font.h3}>All tools</Text>
            <Text style={font.small}>Body clock, sleep need, wind-down, journal, reports — in the More tab</Text>
          </View>
          <Icon name="chevron-right" color={colors.textFaint} />
        </Row>
      </Card>
    </Screen>
  );
}
