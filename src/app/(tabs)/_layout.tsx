import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/state/store';
import { FloatingInsetContext, Icon, NIGHT_BG } from '@/ui/components';
import { FAB_SIZE, NightChromeContext, QuickCheckInButton } from '@/ui/QuickCheckInButton';
import { colors } from '@/ui/theme';
import { WhatsNewSheet } from '@/ui/WhatsNew';

/** Five tabs with short, plain names; everything else is one tap away in More (with search). */
const TABS = [
  { name: 'index', title: 'Today', icon: 'home-variant-outline' },
  { name: 'planner', title: 'Planner', icon: 'calendar-clock' },
  { name: 'nap', title: 'Nap', icon: 'sleep' },
  { name: 'sleep', title: 'Sleep', icon: 'chart-timeline-variant' },
  { name: 'more', title: 'More', icon: 'dots-horizontal-circle-outline' },
];

/**
 * Tab bar height above the bottom inset. Each tab needs ~55 dp (5 padding + 28 icon box + label
 * line + 5 padding); the 49 dp default squeezed the labels until they were clipped.
 */
const TAB_BAR_HEIGHT = 62;

export default function TabLayout() {
  const onboarded = useStore((s) => s.profile.onboarded);
  const insets = useSafeAreaInsets();
  // Today's night view dims the floating button and the tab bar.
  const [night, setNight] = useState(false);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
    <NightChromeContext.Provider value={setNight}>
      <FloatingInsetContext.Provider value={FAB_SIZE + 20}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: night ? colors.textDim : colors.accent,
              tabBarInactiveTintColor: night ? '#3F4566' : colors.textFaint,
              tabBarStyle: {
                backgroundColor: night ? NIGHT_BG : colors.surface,
                borderTopColor: night ? '#11162A' : colors.border,
                height: TAB_BAR_HEIGHT + insets.bottom,
                paddingTop: 3,
                paddingBottom: insets.bottom + 3,
              },
              tabBarLabelStyle: { fontSize: 11.5, lineHeight: 15, fontWeight: '600', marginTop: 2 },
            }}
          >
            {TABS.map((t) => (
              <Tabs.Screen
                key={t.name}
                name={t.name}
                options={{ title: t.title, tabBarIcon: ({ color }) => <Icon name={t.icon} color={String(color)} size={24} /> }}
              />
            ))}
          </Tabs>
          <QuickCheckInButton bottom={TAB_BAR_HEIGHT + insets.bottom + 14} night={night} />
          {/* One-time "What's new / where things moved" after the update that brought these tabs. */}
          <WhatsNewSheet />
        </View>
      </FloatingInsetContext.Provider>
    </NightChromeContext.Provider>
  );
}
