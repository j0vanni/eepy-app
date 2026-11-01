// Settings → Caffeine & drinks: how fast caffeine wears off for you, the bedtime limit and your own drinks.
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { HALF_LIFE_OPTIONS } from '@/engine/caffeine';
import { useStore } from '@/state/store';
import { Card, Icon, ListRow, Row, Section, Segmented, Stepper } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export function CaffeineSection() {
  const profile = useStore((s) => s.profile);
  const customDrinks = useStore((s) => s.settings.customDrinks);
  const setProfile = useStore((s) => s.setProfile);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      <Section title="How caffeine affects you">
        <Card>
          <Text style={[font.body, { marginBottom: 4 }]}>Caffeine half-life</Text>
          <Text style={[font.small, { marginBottom: space.sm }]}>How long half of a coffee takes to wear off in your body.</Text>
          <Segmented value={profile.caffeineHalfLifeH} onChange={(v) => setProfile({ caffeineHalfLifeH: v })} options={HALF_LIFE_OPTIONS.map((o) => ({ label: o.label, value: o.hours }))} />
          <Text style={[font.tiny, { marginTop: 4 }]}>{HALF_LIFE_OPTIONS.find((o) => o.hours === profile.caffeineHalfLifeH)?.hint}</Text>
          <Stepper
            label="Caffeine allowed at bedtime"
            sub="Lower = an earlier last coffee"
            value={`${profile.caffeineBedtimeLimitMg} mg`}
            onDec={() => setProfile({ caffeineBedtimeLimitMg: Math.max(10, profile.caffeineBedtimeLimitMg - 10) })}
            onInc={() => setProfile({ caffeineBedtimeLimitMg: Math.min(150, profile.caffeineBedtimeLimitMg + 10) })}
          />
          <ListRow icon="chart-bell-curve-cumulative" title="See caffeine in your system" sub="Planner → More planning tools" onPress={() => router.navigate({ pathname: '/planner', params: { show: 'caffeine' } })} />
        </Card>
      </Section>
      <Section title="Your drinks">
        <Card>
          {customDrinks.length === 0 ? (
            <Text style={font.small}>None yet. When logging a drink, tap "Your own drink" to save one with your own amount (e.g. how strong you make instant coffee).</Text>
          ) : (
            customDrinks.map((d) => (
              <Row key={d.label} style={{ paddingVertical: 6 }}>
                <Icon name="star-outline" size={16} color={colors.caffeine} />
                <Text style={[font.body, { flex: 1 }]}>
                  {d.label} · {d.mg} mg
                </Text>
                <Pressable onPress={() => setSettings({ customDrinks: customDrinks.filter((c) => c.label !== d.label) })} hitSlop={8} accessibilityLabel={`Remove ${d.label}`}>
                  <Icon name="close" color={colors.textFaint} />
                </Pressable>
              </Row>
            ))
          )}
          <ListRow icon="plus" title="Log a drink" sub="Coffee, tea or energy drink, at the time you had it" onPress={() => router.push('/caffeine')} />
        </Card>
      </Section>
    </>
  );
}
