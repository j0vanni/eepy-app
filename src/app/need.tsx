/**
 * Sleep need: how much sleep you need a night, what you owe (sleep debt) and how the coming nights
 * pay it back, then what the number is based on. How the estimate works is folded away at the end.
 */
import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { ageBaseline, NeedEvidence } from '@/engine/sleepNeed';
import { addDays, formatDuration, formatTime } from '@/engine/time';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, Empty, Fold, Hero, KeyValue, Link, ListCard, ListRow, Meter, Row, Screen, Section } from '@/ui/components';
import { dayLabel } from '@/ui/format';
import { debtColor, font, space } from '@/ui/theme';

const BASED_ON = { override: 'Your own setting', personalized: 'Your own nights', age: 'Your age group' } as const;
const DEBT_WORD = { none: 'Nothing to pay back', low: 'Low', moderate: 'Moderate: you will feel it', high: 'High: it dulls reactions and mood', severe: 'Very high' } as const;

const nights = (n: number) => `${n} night${n === 1 ? '' : 's'}`;

function nightName(wakeDate: string): string {
  const d = dayLabel(addDays(wakeDate, -1));
  return d === 'Today' ? 'Tonight' : `${d} night`;
}

/** One source of the estimate: what it says, why, and how much it counts. */
function EvidenceRow({ e, weight }: { e: NeedEvidence; weight: number }) {
  return (
    <View style={{ paddingVertical: space.md }}>
      <Row gap={space.sm}>
        <Text style={[font.body, { flex: 1 }]}>{e.label}</Text>
        <Text style={[font.h3, { fontVariant: ['tabular-nums'] }]}>{formatDuration(e.estimateMin)}</Text>
      </Row>
      <Text style={[font.small, { marginTop: space.xxs }]}>{e.detail}</Text>
      <Text style={[font.tiny, { marginTop: space.xs }]}>
        Give or take {Math.round(e.sdMin)} min{e.n ? ` · ${e.n} data points` : ''} · counts for {weight}%
      </Text>
    </View>
  );
}

export default function NeedScreen() {
  const a = useAnalysis();
  if (!a) {
    return (
      <Screen>
        <Empty icon="sleep" title="No data yet" body="Your sleep need starts from your age group and becomes personal as nights come in.">
          <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
        </Empty>
      </Screen>
    );
  }
  const n = a.need;
  const debt = a.debt;
  const base = ageBaseline(a.age);
  // Each source counts in proportion to how certain it is.
  const precision = n.evidence.reduce((s, x) => s + 1 / (x.sdMin * x.sdMin), 0);
  const trend =
    debt.trendMin === undefined || Math.abs(debt.trendMin) < 15 ? undefined : debt.trendMin > 0 ? `up ${formatDuration(debt.trendMin)} this week` : `down ${formatDuration(-debt.trendMin)} this week`;
  const payoff = debt.payoff;
  const others = payoff?.alternatives.filter((x) => x.extraMinPerNight !== payoff.extraMinPerNight) ?? [];
  // What eepy has already added to the coming nights.
  const paying = a.upcoming.filter((u) => u.extraForDebtMin > 0).slice(0, 4);
  const clear = a.upcoming.find((u) => u.debtAfterMin < 60);
  const enoughNatural = n.naturalNightsUsed >= n.naturalNightsWanted;

  return (
    <Screen>
      <Hero
        label="You need about"
        value={formatDuration(n.needMin)}
        unit="a night"
        caption={n.method === 'override' ? 'Of actual sleep. You set this yourself.' : `Of actual sleep. Likely between ${formatDuration(n.lowMin)} and ${formatDuration(n.highMin)} · ${n.confidence} confidence.`}
      />
      <ListCard>
        <KeyValue label="Time in bed to get it" sub="With falling asleep and brief wake-ups" value={formatDuration(a.tonight.inBedMin - a.tonight.extraForDebtMin)} />
        <KeyValue label="Based on" value={BASED_ON[n.method]} />
        <ListRow title="Set it yourself" sub="If you know how much sleep you need" onPress={() => router.push({ pathname: '/settings/[section]', params: { section: 'you' } })} />
      </ListCard>

      <Section title="Sleep debt" action={payoff ? <Link label="Open the plan" onPress={() => router.navigate('/planner')} /> : undefined}>
        <ListCard>
          <KeyValue
            label="You owe"
            sub={[DEBT_WORD[debt.category], trend].filter(Boolean).join(' · ')}
            value={debt.category === 'none' ? 'Nothing' : formatDuration(debt.debtMin)}
            color={debtColor(debt.category)}
          />
          {payoff ? <KeyValue label="To pay it back" sub={`About ${payoff.extraMinPerNight} min more sleep than you need, each night`} value={nights(payoff.nights)} /> : null}
          {payoff && others.length ? (
            <Fold bare title="Other ways to pay it back">
              {others.map((o) => (
                <KeyValue key={o.extraMinPerNight} label={`${o.extraMinPerNight} min more a night`} value={o.nights > 21 ? 'Over 3 weeks' : nights(o.nights)} />
              ))}
              <Text style={font.tiny}>Going to bed earlier works better than sleeping in, which shifts your body clock.</Text>
            </Fold>
          ) : null}
        </ListCard>
        {payoff && paying.length ? (
          <Card>
            <Text style={font.small}>eepy has already added a little to the next nights (at most 30 min each) and keeps your wake-ups steady.</Text>
            <View style={{ marginTop: space.xs }}>
              {paying.map((u) => (
                <KeyValue key={u.wakeDate} label={nightName(u.wakeDate)} sub={`Lights out ${formatTime(u.bedtime)}`} value={`+${u.extraForDebtMin} min`} />
              ))}
            </View>
            <Text style={[font.small, { marginTop: space.xs }]}>
              {clear ? `Under 1h by ${dayLabel(clear.wakeDate).toLowerCase()} morning if you follow the plan.` : 'It keeps shrinking over the next two weeks if you follow the plan.'}
            </Text>
          </Card>
        ) : null}
      </Section>

      <Section title="What the number is based on">
        <ListCard>
          {n.evidence.map((e) => (
            <EvidenceRow key={e.key} e={e} weight={Math.round(100 / (e.sdMin * e.sdMin) / precision)} />
          ))}
        </ListCard>
      </Section>

      <Section title="Make it more accurate">
        <Card>
          <Row gap={space.sm}>
            <Text style={[font.body, { flex: 1 }]}>Mornings without an alarm</Text>
            <Text style={[font.h3, { fontVariant: ['tabular-nums'] }]}>
              {Math.min(n.naturalNightsUsed, n.naturalNightsWanted)} of {n.naturalNightsWanted}
            </Text>
          </Row>
          <View style={{ marginVertical: space.sm }}>
            <Meter value={Math.min(n.naturalNightsUsed, n.naturalNightsWanted)} max={n.naturalNightsWanted} />
          </View>
          <Text style={font.small}>
            {enoughNatural
              ? `${n.naturalNightsUsed} nights where you woke on your own: enough for a solid estimate.`
              : 'Each morning you wake on your own, answer "Did you wake up on your own?" with Yes — on Today or in the Journal. Weekends and holidays count most.'}
          </Text>
        </Card>
        <Fold title="How eepy works this out" sub="Your age group, your free mornings and how you feel">
          <Text style={font.small}>{n.explanation}</Text>
          <Text style={[font.small, { marginTop: space.sm }]}>
            Your age group ({base.label}) is the starting point. Genes make a real difference: a few people truly thrive on under 7h, others need 9h or more.
          </Text>
          <Text style={[font.small, { marginTop: space.sm }]}>
            Sleep debt makes you sleep longer when you finally can, so eepy takes part of your debt off those nights before it counts them.
          </Text>
          <Text style={[font.small, { marginTop: space.sm }]}>Rating your energy during the day also lets eepy find the point where more sleep stops making you feel better.</Text>
        </Fold>
      </Section>
    </Screen>
  );
}
