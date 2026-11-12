/**
 * First run, in three short steps: what eepy does, your schedule (workdays, wake-up time, age),
 * and where your nights come from (the watch, demo data, or by hand).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { ageBaseline } from '@/engine/sleepNeed';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { ensureNotificationPermission } from '@/state/notifications';
import { useStore } from '@/state/store';
import { Button, Card, Hero, ListCard, ListRow, Row, Screen, Section, Stepper } from '@/ui/components';
import { DayPicker } from '@/ui/planner/parts';
import { DAY_NAMES, DAY_SHORT } from '@/ui/planner/planText';
import { space } from '@/ui/theme';
import { markWhatsNewSeen } from '@/ui/WhatsNew';

const WHAT_EEPY_DOES = [
  { icon: 'lightning-bolt-outline', title: 'Your energy through the day', sub: 'From your sleep, your watch and your coffee' },
  { icon: 'moon-waning-crescent', title: 'When to go to bed and get up', sub: 'A plan for tonight and the week ahead' },
  { icon: 'scale-balance', title: 'How much sleep you need', sub: 'Learned from your own nights, with what you owe' },
];

export default function Onboarding() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const loadDemo = useStore((s) => s.loadDemo);
  const [step, setStep] = useState(0);
  const year = new Date().getFullYear();
  const age = year - profile.birthYear;
  const android = Platform.OS === 'android';

  const finish = (next: 'connect' | 'demo' | 'manual' | 'home') => {
    setProfile({ onboarded: true });
    // New here: there is nothing "new" to announce, so skip the what's-new sheet.
    markWhatsNewSeen();
    // Android 13+ needs a runtime prompt before wind-down / bedtime reminders can appear.
    if (Platform.OS !== 'web') ensureNotificationPermission().catch(() => undefined);
    if (next === 'demo') loadDemo();
    router.replace('/');
    if (next === 'connect') router.push('/connect');
    if (next === 'manual') router.push('/log-sleep');
  };

  const toggleDay = (d: number) => setProfile({ workdays: profile.workdays.includes(d) ? profile.workdays.filter((x) => x !== d) : [...profile.workdays, d].sort() });

  return (
    <Screen>
      <View style={{ paddingTop: space.xl }}>
        {step === 0 ? (
          <>
            <Hero label="Welcome to eepy" value="Sleep well, know your energy" caption="A sleep coach that reads your CMF Watch." />
            <ListCard>
              {WHAT_EEPY_DOES.map((f) => (
                <ListRow key={f.title} icon={f.icon} title={f.title} sub={f.sub} />
              ))}
            </ListCard>
            <Button label="Get started" onPress={() => setStep(1)} style={{ marginTop: space.md }} />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Hero label="Step 2 of 3" value="Your schedule" caption="The days you have to be up at a fixed time: work, school, kids." />
            <Card>
              <DayPicker days={profile.workdays} onToggle={toggleDay} short={DAY_SHORT} label={(d, on) => `${DAY_NAMES[d]}: ${on ? 'workday' : 'not a workday'}`} />
              <View style={{ marginTop: space.sm }}>
                <Stepper
                  label="Wake-up on those days"
                  sub="You can change this later on the Plan tab"
                  value={formatClock(profile.workWakeMin)}
                  onDec={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin - 15) })}
                  onInc={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin + 15) })}
                />
              </View>
            </Card>
            <Section title="Your age">
              <ListCard>
                <Stepper
                  label="Birth year"
                  sub={`Age ${age}. Sleep need for ${ageBaseline(age).label}, until your own nights take over.`}
                  value={String(profile.birthYear)}
                  onDec={() => setProfile({ birthYear: profile.birthYear - 1 })}
                  onInc={() => setProfile({ birthYear: Math.min(year - 10, profile.birthYear + 1) })}
                />
              </ListCard>
            </Section>
            <Row gap={space.sm} style={{ marginTop: space.md }}>
              <Button kind="ghost" label="Back" onPress={() => setStep(0)} />
              <Button label="Next" onPress={() => setStep(2)} style={{ flex: 1 }} />
            </Row>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Hero
              label="Step 3 of 3"
              value="Your nights"
              caption={
                android
                  ? 'Your watch sends sleep, heart rate, HRV and steps through Health Connect.'
                  : 'Syncing the watch works in the Android app. Here you can look around with demo data.'
              }
            />
            {android ? (
              <Button label="Connect my watch" icon="watch-variant" onPress={() => finish('connect')} />
            ) : (
              <Button label="Look around with demo data" icon="flask-outline" onPress={() => finish('demo')} />
            )}
            <Section title="Or">
              <ListCard>
                {android ? <ListRow icon="flask-outline" title="Look around with demo data" sub="Nine weeks of made-up nights" onPress={() => finish('demo')} /> : null}
                <ListRow icon="pencil-outline" title="Log sleep by hand" sub="For nights without a watch" onPress={() => finish('manual')} />
                <ListRow icon="arrow-right" title="Skip for now" onPress={() => finish('home')} />
              </ListCard>
            </Section>
            <View style={{ alignItems: 'flex-start' }}>
              <Button kind="ghost" label="Back" onPress={() => setStep(1)} />
            </View>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
