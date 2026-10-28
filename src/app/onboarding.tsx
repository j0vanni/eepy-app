import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { ageBaseline } from '@/engine/sleepNeed';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { ensureNotificationPermission } from '@/state/notifications';
import { useStore } from '@/state/store';
import { Button, Card, Chip, Icon, Row, Screen, Stepper } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FEATURES = [
  { icon: 'scale-balance', text: 'Learns how much sleep you personally need' },
  { icon: 'bed-clock', text: 'Tracks your sleep debt and how to pay it back' },
  { icon: 'sleep', text: 'Tells you if (and when, and how long) to nap' },
  { icon: 'lightning-bolt-outline', text: 'Forecasts your energy peaks and dips' },
  { icon: 'alarm', text: 'Plans bedtime, caffeine cut-off and a cycle-timed alarm' },
  { icon: 'watch-variant', text: 'Uses your CMF Watch 3 Pro data via Health Connect' },
];

export default function Onboarding() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const loadDemo = useStore((s) => s.loadDemo);
  const [step, setStep] = useState(0);
  const year = new Date().getFullYear();
  const age = year - profile.birthYear;
  const base = ageBaseline(age);

  const finish = (next: 'connect' | 'demo' | 'manual' | 'home') => {
    setProfile({ onboarded: true });
    // Android 13+ needs a runtime prompt before wind-down / bedtime reminders can appear.
    if (Platform.OS !== 'web') ensureNotificationPermission().catch(() => undefined);
    if (next === 'demo') loadDemo();
    router.replace('/');
    if (next === 'connect') router.push('/connect');
    if (next === 'manual') router.push('/log-sleep');
  };

  return (
    <Screen>
      {step === 0 ? (
        <View style={{ paddingTop: space.xl }}>
          <Icon name="weather-night" size={56} color={colors.accent} />
          <Text style={[font.h1, { fontSize: 40, marginTop: space.md }]}>eepy</Text>
          <Text style={[font.body, { color: colors.textDim, marginTop: space.sm, marginBottom: space.xl }]}>Sleep science for the way you actually live.</Text>
          {FEATURES.map((f) => (
            <Row key={f.text} gap={space.md} style={{ marginBottom: space.md }}>
              <Icon name={f.icon} color={colors.accent} size={22} />
              <Text style={[font.body, { flex: 1 }]}>{f.text}</Text>
            </Row>
          ))}
          <View style={{ marginTop: space.xl }}>
            <Button label="Get started" onPress={() => setStep(1)} />
          </View>
        </View>
      ) : null}

      {step === 1 ? (
        <View style={{ paddingTop: space.xl }}>
          <Text style={font.h1}>About you</Text>
          <Text style={[font.small, { marginTop: space.sm, marginBottom: space.lg }]}>Sleep need changes with age; it's our starting point before your own data takes over.</Text>
          <Card>
            <Stepper
              label="Birth year"
              sub={`Age ${age}`}
              value={String(profile.birthYear)}
              onDec={() => setProfile({ birthYear: profile.birthYear - 1 })}
              onInc={() => setProfile({ birthYear: Math.min(year - 10, profile.birthYear + 1) })}
            />
          </Card>
          <Text style={[font.small, { marginBottom: space.lg }]}>Recommended for {base.label}.</Text>
          <Row gap={space.sm}>
            <Button kind="ghost" label="Back" onPress={() => setStep(0)} />
            <Button label="Next" onPress={() => setStep(2)} />
          </Row>
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ paddingTop: space.xl }}>
          <Text style={font.h1}>Your schedule</Text>
          <Text style={[font.small, { marginTop: space.sm, marginBottom: space.lg }]}>Which days have a fixed wake-up (work, school, kids)?</Text>
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md }}>
              {DAYS.map((d, i) => (
                <Chip
                  key={d}
                  label={d}
                  selected={profile.workdays.includes(i)}
                  onPress={() => setProfile({ workdays: profile.workdays.includes(i) ? profile.workdays.filter((x) => x !== i) : [...profile.workdays, i].sort() })}
                />
              ))}
            </View>
            <Stepper
              label="Wake-up time on those days"
              value={formatClock(profile.workWakeMin)}
              onDec={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin - 15) })}
              onInc={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin + 15) })}
            />
          </Card>
          <Row gap={space.sm}>
            <Button kind="ghost" label="Back" onPress={() => setStep(1)} />
            <Button label="Next" onPress={() => setStep(3)} />
          </Row>
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ paddingTop: space.xl }}>
          <Text style={font.h1}>Your sleep data</Text>
          <Text style={[font.small, { marginTop: space.sm, marginBottom: space.lg }]}>
            {Platform.OS === 'android'
              ? 'Connect your CMF Watch through Health Connect for automatic sleep stages, heart rate, HRV and SpO₂.'
              : 'Watch syncing works in the Android app. You can explore with demo data here.'}
          </Text>
          <View style={{ gap: space.sm }}>
            {Platform.OS === 'android' ? <Button label="Connect CMF Watch" icon="watch-variant" onPress={() => finish('connect')} /> : null}
            <Button label="Explore with demo data" icon="flask-outline" kind="secondary" onPress={() => finish('demo')} />
            <Button label="Log sleep manually" icon="pencil" kind="secondary" onPress={() => finish('manual')} />
            <Button label="Skip for now" kind="ghost" onPress={() => finish('home')} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
