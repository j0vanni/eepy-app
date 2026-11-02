import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ageBaseline } from '@/engine/sleepNeed';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { ensureNotificationPermission } from '@/state/notifications';
import { useStore } from '@/state/store';
import { Button, Card, Icon, Row, Screen, Stepper } from '@/ui/components';
import { colors, font, radius, space } from '@/ui/theme';
import { markWhatsNewSeen } from '@/ui/WhatsNew';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Monday first, like the Planner's usual week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** "Step 2 of 3" as dots. */
function Progress({ step }: { step: number }) {
  return (
    <Row gap={6} style={{ marginBottom: space.lg }}>
      {[1, 2, 3].map((i) => (
        <View key={i} style={[styles.dot, i === step ? styles.dotOn : i < step ? styles.dotDone : null]} />
      ))}
      <Text style={[font.tiny, { marginLeft: space.xs }]}>{`Step ${step} of 3`}</Text>
    </Row>
  );
}

function BackNext({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <Row gap={space.sm} style={{ marginTop: space.lg }}>
      <Button kind="ghost" label="Back" onPress={onBack} />
      <Button label="Next" onPress={onNext} style={{ flex: 1 }} />
    </Row>
  );
}

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
    // New here: nothing has "moved", so skip the what's-new sheet.
    markWhatsNewSeen();
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
          <View style={styles.logo}>
            <Icon name="weather-night" size={40} color={colors.accent} />
          </View>
          <Text style={[font.h1, { fontSize: 40, lineHeight: 46, marginTop: space.md }]}>eepy</Text>
          <Text style={[font.body, { color: colors.textDim, marginTop: space.xs, marginBottom: space.xl }]}>Sleep science for the way you actually live.</Text>
          {FEATURES.map((f) => (
            <Row key={f.text} gap={space.md} style={{ marginBottom: space.md }}>
              <View style={styles.featureIcon}>
                <Icon name={f.icon} color={colors.accent} size={20} />
              </View>
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
          <Progress step={1} />
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
          <Text style={font.small}>Recommended for {base.label}.</Text>
          <BackNext onBack={() => setStep(0)} onNext={() => setStep(2)} />
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ paddingTop: space.xl }}>
          <Progress step={2} />
          <Text style={font.h1}>Your schedule</Text>
          <Text style={[font.small, { marginTop: space.sm, marginBottom: space.lg }]}>Which days do you have to be up at a fixed time (work, school, kids)? You can change this later in Planner → Your usual week.</Text>
          <Card>
            <Row gap={4} style={{ marginBottom: space.sm }}>
              {WEEK_ORDER.map((i) => {
                const on = profile.workdays.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() => setProfile({ workdays: on ? profile.workdays.filter((x) => x !== i) : [...profile.workdays, i].sort() })}
                    style={({ pressed }) => [styles.day, on ? styles.dayOn : null, pressed ? { opacity: 0.7 } : null]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={DAYS[i]}
                  >
                    <Text style={[styles.dayText, on ? { color: colors.onAccent } : null]}>{DAYS[i]}</Text>
                  </Pressable>
                );
              })}
            </Row>
            <Stepper
              label="Wake-up time on those days"
              value={formatClock(profile.workWakeMin)}
              onDec={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin - 15) })}
              onInc={() => setProfile({ workWakeMin: normalizeMinutes(profile.workWakeMin + 15) })}
            />
          </Card>
          <BackNext onBack={() => setStep(1)} onNext={() => setStep(3)} />
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ paddingTop: space.xl }}>
          <Progress step={3} />
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
          <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
            <Button small kind="ghost" label="Back" icon="arrow-left" onPress={() => setStep(2)} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { width: 72, height: 72, borderRadius: 24, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  featureIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 22, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.accent },
  dotDone: { backgroundColor: colors.accentSoft },
  day: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.text, fontWeight: '700', fontSize: 13 },
});
