// Settings → About: the version, what's new, and what eepy is (and isn't).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { Card, ListRow, Section } from '@/ui/components';
import { font } from '@/ui/theme';

export function AboutSection() {
  return (
    <Section title="About">
      <Card>
        <Text style={font.small}>
          eepy {Constants.expoConfig?.version ?? ''} — sleep coaching built on published sleep science (two-process and three-process models, MCTQ chronotype, Sleep
          Regularity Index). It is not a medical device and cannot diagnose sleep disorders. If you snore loudly, stop breathing at night, or are very sleepy despite
          enough sleep, please see a doctor.
        </Text>
        <ListRow icon="gift-outline" title="What's new" sub="The new tabs and where things moved" onPress={() => router.push('/whats-new')} />
      </Card>
    </Section>
  );
}
