/**
 * Coach: the experiment you are running (or the one worth starting), today's goals, this week's
 * review and what to try next. Every row opens its own screen.
 */
import { router } from 'expo-router';
import { Text } from 'react-native';

import { fillTarget, TEMPLATE_BY_ID } from '@/engine/experiments';
import { WIND_DOWN_TAG } from '@/engine/goals';
import { formatDuration } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { GOAL_STATUS_TEXT } from '@/ui/coach/Dots';
import { useActiveExperiment, useExperimentResult, useGoalsSummary, useLatestReview, useSuggestions } from '@/ui/coach/hooks';
import { ExperimentHero, ExperimentQuestion } from '@/ui/coach/parts';
import { Banner, Button, Empty, Hero, Link, ListCard, ListRow, Screen, Section } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const streak = (n: number) => (n > 0 ? `${n}-day streak` : undefined);

export default function CoachScreen() {
  const a = useAnalysis();
  const active = useActiveExperiment();
  const result = useExperimentResult(a, active);
  const suggestions = useSuggestions(a);
  const summary = useGoalsSummary(a);
  const latest = useLatestReview(a);
  const toggleTag = useStore((s) => s.toggleTag);

  if (!a) {
    return (
      <Screen>
        <Empty icon="account-heart-outline" title="Your sleep coach" body="Once a few nights are in, this is where you run experiments, build streaks and get a weekly review of your sleep.">
          <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
        </Empty>
        <ListCard>
          <ListRow icon="dots-horizontal" title="All tools" onPress={() => router.navigate('/more')} />
        </ListCard>
      </Screen>
    );
  }

  const top = suggestions[0];
  const setUp = (template: string) => router.push({ pathname: '/experiments', params: { template } });
  // What to try next: the best-fitting experiments, then advice that has an experiment to test it.
  const next = (active ? suggestions.slice(0, 2) : suggestions.slice(1, 3)).map((s) => ({ id: s.template.id, icon: s.template.icon, title: s.template.title, sub: s.reason ?? fillTarget(s.template.rule) }));
  for (const t of a.tips) {
    const id = t.experimentId;
    if (!id || !TEMPLATE_BY_ID[id] || id === active?.templateId || next.some((n) => n.id === id) || next.length >= 4) continue;
    next.push({ id, icon: t.icon, title: TEMPLATE_BY_ID[id].title, sub: `Tests the advice: ${t.title}` });
  }
  const review = latest?.review;
  const windDown = summary?.goals.find((g) => g.setting.id === 'wind-down' && g.today.status === 'pending');

  return (
    <Screen>
      {a.recoveryAlert ? (
        <Banner tone={a.recoveryAlert.level === 'warning' ? 'bad' : 'warn'} icon="heart-pulse" text={a.recoveryAlert.title} action="Details" onAction={() => router.push('/energy')} />
      ) : null}

      {active && result ? (
        <>
          <ExperimentHero a={a} exp={active} result={result} link />
          {result.needsAnswer && !result.complete ? <ExperimentQuestion exp={active} date={result.needsAnswer} today={a.day} /> : null}
        </>
      ) : top ? (
        <>
          <Hero
            label="Worth trying this week"
            value={top.template.title}
            caption={`${top.reason ? `${top.reason}. ` : ''}${top.template.durationDays} nights, then a before and after from your own data.`}
          />
          <Button icon="flask-outline" label="Set it up" onPress={() => setUp(top.template.id)} style={{ marginBottom: space.md }} />
        </>
      ) : null}

      <Section title="Goals today" action={<Link label={summary?.goals.length ? 'Edit' : 'Pick'} onPress={() => router.push('/goals')} />}>
        <ListCard>
          {summary?.goals.length ? (
            summary.goals.map((g) => {
              const st = GOAL_STATUS_TEXT[g.today.status];
              return (
                <ListRow
                  key={g.setting.id}
                  icon={st.icon}
                  iconColor={st.color}
                  title={g.def.title}
                  sub={g.today.status === 'pending' ? g.today.detail : [st.label, g.today.detail].filter(Boolean).join(' · ')}
                  value={streak(g.currentStreak)}
                  onPress={() => router.push('/goals')}
                />
              );
            })
          ) : (
            <ListRow icon="flag-outline" title="Pick up to three goals" sub="A steady wake time, less sleep debt, a caffeine cut-off: small daily wins that build streaks" onPress={() => router.push('/goals')} />
          )}
          {windDown ? (
            <ListRow icon="weather-night" title="I wound down tonight" sub="Ticks today's wind-down goal" onPress={() => toggleTag(a.day, WIND_DOWN_TAG)} right={<Text style={[font.small, { color: colors.accent, fontWeight: '700' }]}>Done</Text>} />
          ) : null}
        </ListCard>
      </Section>

      <Section title="This week">
        <ListCard>
          {review && latest && review.nightsRecorded >= 3 ? (
            <ListRow
              icon="calendar-week"
              iconColor={latest.isNew ? colors.accent : undefined}
              title={`Your week · ${review.label}`}
              sub={[
                review.avgSleepMin !== undefined ? `${formatDuration(review.avgSleepMin)} a night` : undefined,
                review.avgScore !== undefined ? `score ${Math.round(review.avgScore)}` : undefined,
                `next: ${review.focus.title.charAt(0).toLowerCase()}${review.focus.title.slice(1)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
              value={latest.isNew ? 'New' : undefined}
              onPress={() => router.push({ pathname: '/review', params: { week: latest.week } })}
            />
          ) : (
            <ListRow icon="calendar-week" title="Weekly review" sub="Your first one arrives on Sunday evening, once a few nights are recorded" />
          )}
        </ListCard>
      </Section>

      <Section title={active ? 'Up next' : 'More to try'} action={<Link label="All experiments" onPress={() => router.push('/experiments')} />}>
        <ListCard>
          {next.map((n) => (
            <ListRow key={n.id} icon={n.icon} title={n.title} sub={n.sub} onPress={() => setUp(n.id)} />
          ))}
          <ListRow icon="dots-horizontal" title="All tools" sub="Body clock, sleep need, wind-down, journal, reports" onPress={() => router.navigate('/more')} />
        </ListCard>
      </Section>
    </Screen>
  );
}
