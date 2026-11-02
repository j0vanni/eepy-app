// Settings → About: the version, what's new, and what eepy is (and isn't).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Text } from 'react-native';

import { Card, ListRow, Section } from '@/ui/components';
import { font, space } from '@/ui/theme';

export function AboutSection() {
  return (
    <Section title="">
      <Card>
        <Text style={font.h3}>eepy {Constants.expoConfig?.version ?? ''}</Text>
        <Text style={[font.small, { marginTop: space.xs }]}>
          Sleep coaching built on published sleep science (two-process and three-process models, MCTQ chronotype, Sleep Regularity Index).
        </Text>
        <Text style={[font.small, { marginTop: space.sm }]}>
          It is not a medical device and cannot diagnose sleep disorders. If you snore loudly, stop breathing at night, or are very sleepy despite enough sleep, please see a
          doctor.
        </Text>
        <ListRow icon="gift-outline" title="What's new" sub="The new tabs and where things moved" onPress={() => router.push('/whats-new')} />
      </Card>
    </Section>
  );
}
