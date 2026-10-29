import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStore } from '@/state/store';
import { FloatingInsetContext, Icon } from '@/ui/components';
import { FAB_SIZE, QuickCheckInButton } from '@/ui/QuickCheckInButton';
import { colors } from '@/ui/theme';

const TABS = [
  { name: 'index', title: 'Today', icon: 'weather-night' },
  { name: 'nap', title: 'Nap', icon: 'sleep' },
  { name: 'plan', title: 'Plan', icon: 'calendar-clock' },
  { name: 'coach', title: 'Coach', icon: 'account-heart-outline' },
  { name: 'trends', title: 'Trends', icon: 'chart-timeline-variant' },
];

// Matches the JS tab bar's own height (49 + bottom inset) so the button floats just above it.
const TAB_BAR_HEIGHT = 49;

export default function TabLayout() {
  const onboarded = useStore((s) => s.profile.onboarded);
  const insets = useSafeAreaInsets();
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
    <FloatingInsetContext.Provider value={FAB_SIZE + 20}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textFaint,
            tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          }}
        >
          {TABS.map((t) => (
            <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarIcon: ({ color, size }) => <Icon name={t.icon} color={String(color)} size={size} /> }} />
          ))}
        </Tabs>
        <QuickCheckInButton bottom={TAB_BAR_HEIGHT + insets.bottom + 16} />
      </View>
    </FloatingInsetContext.Provider>
  );
}
