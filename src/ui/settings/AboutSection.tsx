// Settings → About: the version, what's new, and what eepy is (and isn't).
import Constants from 'expo-constants';
import { router } from 'expo-router';

import { Fold, Hero, ListCard, ListRow, Note } from '@/ui/components';

import { Para } from './parts';

export function AboutSection() {
  return (
    <>
      <Hero label="Version" value={`eepy ${Constants.expoConfig?.version ?? ''}`.trim()} caption="A sleep coach built on published sleep science." />
      <ListCard>
        <ListRow icon="gift-outline" title="What's new" sub="What changed in this version" onPress={() => router.push('/whats-new')} />
        <ListRow icon="cellphone-arrow-down" title="App updates" onPress={() => router.push('/updates')} />
        <Fold bare icon="school-outline" title="The science behind it">
          <Para first>Energy and sleep pressure: the two-process and three-process models of sleep regulation.</Para>
          <Para>Your body clock: the Munich Chronotype Questionnaire (MCTQ) method, from your sleep on free days.</Para>
          <Para>Regularity: the Sleep Regularity Index.</Para>
        </Fold>
      </ListCard>
      <Note tone="info">
        eepy is not a medical device and cannot diagnose sleep disorders. If you snore loudly, stop breathing at night, or are very sleepy despite enough sleep, please see a doctor.
      </Note>
    </>
  );
}
