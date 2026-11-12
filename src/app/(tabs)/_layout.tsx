import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/state/store';
import { Icon } from '@/ui/components';
import { NightChromeContext } from '@/ui/nightChrome';
import { CHART_FONT, colors, night as nightColors } from '@/ui/theme';
import { WhatsNewSheet } from '@/ui/WhatsNew';

/** Four tabs, each answering one question; every tool and setting is in More (with search). */
const TABS = [
  { name: 'index', title: 'Today', icon: 'white-balance-sunny' },
  { name: 'sleep', title: 'Sleep', icon: 'moon-waning-crescent' },
  { name: 'planner', title: 'Plan', icon: 'calendar-clock-outline' },
  { name: 'more', title: 'More', icon: 'menu' },
];

/** Tab bar height above the bottom inset: 28 dp icon box + label line + padding. */
const TAB_BAR_HEIGHT = 62;

export default function TabLayout() {
  const onboarded = useStore((s) => s.profile.onboarded);
  const insets = useSafeAreaInsets();
  // Today's night view dims the tab bar.
  const [night, setNight] = useState(false);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
    <NightChromeContext.Provider value={setNight}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: night ? nightColors.text : colors.accent,
            tabBarInactiveTintColor: night ? nightColors.textDim : colors.textFaint,
            tabBarStyle: {
              backgroundColor: night ? nightColors.bg : colors.bg,
              borderTopColor: night ? nightColors.border : colors.border,
              height: TAB_BAR_HEIGHT + insets.bottom,
              paddingTop: 3,
              paddingBottom: insets.bottom + 3,
            },
            tabBarLabelStyle: { fontSize: 11.5, lineHeight: 15, fontWeight: '700', marginTop: 2, ...(Platform.OS === 'web' ? { fontFamily: CHART_FONT } : null) },
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
        {/* One-time "what changed" after an update that moved things. */}
        <WhatsNewSheet />
      </View>
    </NightChromeContext.Provider>
  );
}
