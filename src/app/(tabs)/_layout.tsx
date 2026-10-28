import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';

import { useStore } from '@/state/store';
import { Icon } from '@/ui/components';
import { colors } from '@/ui/theme';

const TABS = [
  { name: 'index', title: 'Today', icon: 'weather-night' },
  { name: 'nap', title: 'Nap', icon: 'sleep' },
  { name: 'plan', title: 'Plan', icon: 'calendar-clock' },
  { name: 'trends', title: 'Trends', icon: 'chart-timeline-variant' },
  { name: 'journal', title: 'Journal', icon: 'notebook-outline' },
];

export default function TabLayout() {
  const onboarded = useStore((s) => s.profile.onboarded);
  if (!onboarded) return <Redirect href="/onboarding" />;
  return (
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
  );
}
