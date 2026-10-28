import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { ageBaseline } from '@/engine/sleepNeed';
import { formatDuration } from '@/engine/time';
import { useAnalysis } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Empty, Meter, Note, Row, Screen, Section, Stat } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export default function NeedScreen() {
  const a = useAnalysis();
  if (!a) {
    return (
      <Screen>
        <Empty icon="sleep" title="No data yet" body="Your sleep need starts from your age group and becomes personal as nights come in." />
      </Screen>
    );
  }
  const n = a.need;
  const base = ageBaseline(a.age);
  return (
    <Screen>
      <Card>
        <Text style={font.tiny}>YOU NEED ABOUT</Text>
        <Text style={[font.stat, { fontSize: 40, marginVertical: 4 }]}>{formatDuration(n.needMin)}</Text>
        <Text style={font.small}>of actual sleep per night{n.method !== 'override' ? ` (likely ${formatDuration(n.lowMin)}–${formatDuration(n.highMin)})` : ''}</Text>
        <Row style={{ marginTop: space.md }}>
          <Stat label="Method" value={n.method === 'override' ? 'Manual' : n.method === 'personalized' ? 'Personal' : 'Age-based'} />
          <Stat label="Confidence" value={n.confidence} color={n.confidence === 'high' ? colors.good : n.confidence === 'medium' ? colors.accent : colors.warn} />
          <Stat label="Time in bed" value={formatDuration(a.tonight.inBedMin - a.tonight.extraForDebtMin)} sub="to get it" />
        </Row>
        <Text style={[font.body, { marginTop: space.md }]}>{n.explanation}</Text>
      </Card>

      <Section title="Evidence">
        {n.evidence.map((e) => (
          <Card key={e.key}>
            <CardTitle icon={{ age: 'account-clock-outline', natural: 'weather-sunny', energy: 'lightning-bolt-outline' }[e.key]} title={e.label} right={<Text style={font.h3}>{formatDuration(e.estimateMin)}</Text>} />
            <Text style={font.small}>{e.detail}</Text>
            <Text style={[font.tiny, { marginTop: 6 }]}>
              ± {Math.round(e.sdMin)} min uncertainty{e.n ? ` · ${e.n} data points` : ''} · weight {Math.round((100 / (e.sdMin * e.sdMin)) / n.evidence.reduce((s, x) => s + 1 / (x.sdMin * x.sdMin), 0))}%
            </Text>
          </Card>
        ))}
      </Section>

      <Section title="Make it more accurate">
        <Card>
          <Text style={font.body}>Unrestricted nights</Text>
          <View style={{ marginVertical: space.sm }}>
            <Meter value={Math.min(n.naturalNightsUsed, n.naturalNightsWanted)} max={n.naturalNightsWanted} color={colors.good} />
          </View>
          <Text style={font.small}>
            {n.naturalNightsUsed} of {n.naturalNightsWanted} nights where you woke without an alarm. Each morning, tap "Yes, naturally" in the Journal when that's the case —
            especially on weekends and holidays.
          </Text>
          <Text style={[font.small, { marginTop: space.md }]}>
            Rating your daytime energy also lets eepy find the point where more sleep stops making you feel better.
          </Text>
        </Card>
        <Note tone="info">
          Your age group ({base.label}) is the starting point. Genetics make a real difference: a small number of people truly thrive on under 7h, while others need
          9h+. Sleep debt inflates how long you sleep when you finally can, so eepy subtracts part of your debt from those nights.
        </Note>
        <Button kind="ghost" label="Set my need manually" onPress={() => router.push('/settings')} />
      </Section>
    </Screen>
  );
}
