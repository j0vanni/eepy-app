import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { configureNotifications, scheduleDailyReminders } from '@/state/notifications';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { useAutoSync } from '@/state/sync';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent },
};

function Background() {
  useAutoSync();
  const analysis = useAnalysis();
  const prefs = useStore((s) => s.settings.notifications);
  useEffect(() => {
    if (Platform.OS !== 'web') configureNotifications().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (analysis) scheduleDailyReminders(analysis, prefs).catch(() => undefined);
  }, [analysis, prefs]);
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
      </Stack>
    </ThemeProvider>
  );
}
