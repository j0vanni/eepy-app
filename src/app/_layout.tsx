import * as Notifications from 'expo-notifications';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { registerBackgroundSync } from '@/background/task';
import { syncWakeAlarm } from '@/notifications/fullScreenAlarm';
import { configureNotifications, handleNotificationResponse, replanNotifications } from '@/state/notifications';
import { useLearning } from '@/state/learning';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { useAutoSync } from '@/state/sync';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent },
};

/** App-wide side effects: sync, notification planning, notification responses, background task. */
function Background() {
  useAutoSync();
  useLearning();
  const analysis = useAnalysis();
  const settings = useStore((s) => s.settings);
  const goals = useStore((s) => s.goals);
  const experiments = useStore((s) => s.experiments);
  const checkins = useStore((s) => s.checkins);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    configureNotifications().catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handleNotificationResponse(r, useStore.getState()).catch(() => undefined);
    });
    // A notification tapped while the app was closed.
    Notifications.getLastNotificationResponseAsync()
      .then((r) => r && handleNotificationResponse(r, useStore.getState()))
      .catch(() => undefined);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') registerBackgroundSync(settings.background.enabled).catch(() => undefined);
  }, [settings.background.enabled]);

  useEffect(() => {
    if (!analysis) return;
    replanNotifications(analysis, useStore.getState()).catch(() => undefined);
    // On builds with the native alarm module the wake alarm is scheduled natively, not by the planner.
    syncWakeAlarm(analysis, useStore.getState()).catch(() => undefined);
  }, [analysis, settings.notifications, settings.napTimer, goals, experiments, checkins]);
  return null;
}

export default function RootLayout() {
  const hydrated = useStore((s) => s.hydrated);
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => undefined);
  }, [hydrated]);
  if (!hydrated) return null;
  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Background />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="connect" options={{ title: 'Connect CMF Watch' }} />
        <Stack.Screen name="night/[id]" options={{ title: 'Night details' }} />
        <Stack.Screen name="quiz/[id]" options={{ title: '' }} />
        <Stack.Screen name="jetlag" options={{ title: 'Jet lag planner' }} />
        <Stack.Screen name="log-sleep" options={{ title: 'Log sleep', presentation: 'modal' }} />
        <Stack.Screen name="need" options={{ title: 'Your sleep need' }} />
        <Stack.Screen name="journal" options={{ title: 'Journal' }} />
        <Stack.Screen name="checkin" options={{ title: 'Quick check-in', presentation: 'modal' }} />
        <Stack.Screen name="simulate" options={{ title: 'What if?' }} />
        <Stack.Screen name="learning" options={{ title: 'Your body clock' }} />
        <Stack.Screen name="experiments/index" options={{ title: 'Experiments' }} />
        <Stack.Screen name="experiments/[id]" options={{ title: 'Experiment' }} />
        <Stack.Screen name="goals" options={{ title: 'Goals' }} />
        <Stack.Screen name="review" options={{ title: 'Weekly review' }} />
        <Stack.Screen name="winddown" options={{ title: 'Wind down' }} />
        <Stack.Screen name="cbti" options={{ title: 'Insomnia programme' }} />
        <Stack.Screen name="export" options={{ title: 'Reports & export' }} />
      </Stack>
    </ThemeProvider>
  );
}
