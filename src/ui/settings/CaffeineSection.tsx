// Settings → Caffeine & drinks: how fast caffeine wears off for you, the bedtime limit and your own drinks.
import { router } from 'expo-router';

import { HALF_LIFE_OPTIONS } from '@/engine/caffeine';
import { useStore } from '@/state/store';
import { IconButton, ListCard, ListRow, Section, Stepper } from '@/ui/components';
import { colors } from '@/ui/theme';

import { ChoiceRow } from './parts';

export function CaffeineSection() {
  const profile = useStore((s) => s.profile);
  const customDrinks = useStore((s) => s.settings.customDrinks);
  const setProfile = useStore((s) => s.setProfile);
  const setSettings = useStore((s) => s.setSettings);
  return (
    <>
      <Section title="How caffeine affects you">
        <ListCard>
          <ChoiceRow
            title="How fast it wears off"
            sub="The time half of a coffee takes to leave your body (half-life)"
            value={profile.caffeineHalfLifeH}
            onChange={(v) => setProfile({ caffeineHalfLifeH: v })}
            options={HALF_LIFE_OPTIONS.map((o) => ({ label: o.label, value: o.hours }))}
            hint={HALF_LIFE_OPTIONS.map((o) => `${o.label.split(' ')[0]}: ${o.hint}`).join('\n')}
          />
          <Stepper
            label="Caffeine allowed at bedtime"
            sub="Lower means an earlier last coffee"
            value={`${profile.caffeineBedtimeLimitMg} mg`}
            onDec={() => setProfile({ caffeineBedtimeLimitMg: Math.max(10, profile.caffeineBedtimeLimitMg - 10) })}
            onInc={() => setProfile({ caffeineBedtimeLimitMg: Math.min(150, profile.caffeineBedtimeLimitMg + 10) })}
          />
          <ListRow title="Caffeine in your system" sub="Plan › Tools" onPress={() => router.navigate({ pathname: '/planner', params: { show: 'caffeine' } })} />
        </ListCard>
      </Section>
      <Section title="Your drinks">
        <ListCard>
          {customDrinks.length === 0 ? <ListRow icon="star-outline" title="None yet" sub={'When you log a drink, "Your own drink" saves one with your own amount'} /> : null}
          {customDrinks.map((d) => (
            <ListRow
              key={d.label}
              icon="star-outline"
              iconColor={colors.caffeine}
              title={d.label}
              sub={`${d.mg} mg`}
              right={<IconButton icon="close" label={`Remove ${d.label}`} color={colors.textFaint} onPress={() => setSettings({ customDrinks: customDrinks.filter((c) => c.label !== d.label) })} />}
            />
          ))}
          <ListRow icon="plus" title="Log a drink" sub="Coffee, tea or energy drink, at the time you had it" onPress={() => router.push('/caffeine')} />
        </ListCard>
      </Section>
    </>
  );
}
