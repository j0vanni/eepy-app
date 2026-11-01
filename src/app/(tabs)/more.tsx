/**
 * More: everything that isn't on the other tabs, grouped under plain headings, with a search box
 * that also finds single settings ("Find a feature or setting…").
 */
import { Href, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable } from 'react-native';

import { cbtiStatus, CBTI_WEEKS } from '@/engine/cbti';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, Icon, ListRow, Screen, Section } from '@/ui/components';
import { FeatureSearch } from '@/ui/FeatureSearch';
import { SelfChecksCard } from '@/ui/settings/SelfChecks';
import { colors } from '@/ui/theme';

interface Item {
  icon: string;
  title: string;
  sub: string;
  href: Href;
  color?: string;
}

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <Section title={title}>
      <Card style={{ paddingVertical: 4 }}>
        {items.map((i) => (
          <ListRow key={i.title} icon={i.icon} iconColor={i.color} title={i.title} sub={i.sub} onPress={() => router.push(i.href)} />
        ))}
      </Card>
    </Section>
  );
}

export default function MoreScreen() {
  const a = useAnalysis();
  const program = useStore((s) => s.cbti);
  const [searching, setSearching] = useState(false);
  const cbti = useMemo(() => (a && program?.active ? cbtiStatus(program, a.nights, a.day) : undefined), [a, program]);

  const settingsButton = (
    <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Settings" hitSlop={8}>
      <Icon name="cog-outline" size={24} color={colors.textDim} />
    </Pressable>
  );

  return (
    <Screen title="More" subtitle="Everything else, in one place" right={settingsButton}>
      <FeatureSearch onSearchingChange={setSearching} />
      {searching ? null : (
        <>
          <Group
            title="Coach"
            items={[
              { icon: 'account-heart-outline', title: 'Coach', sub: 'Your experiment, goals and this week in one place', href: '/coach' },
              { icon: 'flask-outline', title: 'Experiments', sub: 'Test what really changes your sleep', href: '/experiments' },
              { icon: 'flag-checkered', title: 'Goals & streaks', sub: 'Small daily wins, one day at a time', href: '/goals', color: colors.good },
              { icon: 'calendar-week', title: 'Weekly review', sub: 'Your week in sleep, every Sunday', href: '/review', color: colors.info },
            ]}
          />
          <Group
            title="Learn"
            items={[
              { icon: 'clock-time-four-outline', title: 'Your body clock', sub: 'When your energy peaks and dips — and how eepy learns it', href: '/learning', color: colors.energy },
              { icon: 'battery-charging-high', title: 'Your sleep need', sub: 'How much sleep you really need, and how sure eepy is', href: '/need', color: colors.good },
              { icon: 'tune-variant', title: 'What if?', sub: 'Try a bedtime, nap or coffee and see tomorrow change', href: '/simulate', color: colors.rem },
            ]}
          />
          <Section title="Self-checks">
            <SelfChecksCard />
          </Section>
          <Group
            title="Wind-down"
            items={[
              { icon: 'weather-night', title: 'Wind-down routine', sub: 'Countdown, checklist, breathing and sleep sounds', href: '/winddown', color: colors.light },
              { icon: 'music-note-outline', title: 'Sounds & bedtime autopilot', sub: 'Default sound and timer, screens off, phone sleep mode', href: { pathname: '/settings/[section]', params: { section: 'winddown' } }, color: colors.rem },
              { icon: 'brightness-6', title: 'Phone light', sub: 'How bright your screen should be this evening', href: { pathname: '/planner', params: { show: 'light' } }, color: colors.light },
            ]}
          />
          <Group
            title="Programmes"
            items={[
              {
                icon: 'account-heart',
                title: 'Insomnia programme',
                sub: cbti ? `Week ${cbti.week}${cbti.maintenance ? ', maintenance' : ` of ${CBTI_WEEKS}`}` : '6-week programme for trouble sleeping (CBT-I)',
                href: '/cbti',
                color: colors.bad,
              },
              { icon: 'airplane-clock', title: 'Jet lag planner', sub: 'A day-by-day plan for crossing time zones', href: '/jetlag', color: colors.info },
            ]}
          />
          <Group
            title="Your data"
            items={[
              { icon: 'notebook-outline', title: 'Journal', sub: 'Tags, ratings and drinks, day by day', href: '/journal', color: colors.warn },
              { icon: 'pencil-plus', title: 'Log a night yourself', sub: 'Slept without the watch? Add it here', href: '/log-sleep' },
              { icon: 'coffee', title: 'Log a drink', sub: 'Coffee, tea or energy drink, at the time you had it', href: '/caffeine', color: colors.caffeine },
              { icon: 'file-chart-outline', title: 'Reports & export', sub: 'PDF for you or your doctor, CSV of every night', href: '/export', color: colors.textDim },
              { icon: 'link-variant', title: 'Connect your CMF Watch', sub: 'Health Connect setup, step by step', href: '/connect' },
            ]}
          />
          <Group
            title="App"
            items={[
              { icon: 'cog-outline', title: 'Settings', sub: 'Alarms, reminders, sounds, caffeine, sync and more', href: '/settings', color: colors.textDim },
              { icon: 'cellphone-arrow-down', title: 'App updates', sub: 'Get the newest version of eepy', href: '/updates', color: colors.textDim },
              { icon: 'gift-outline', title: "What's new", sub: 'The new tabs and where things moved', href: '/whats-new', color: colors.accent },
            ]}
          />
        </>
      )}
    </Screen>
  );
}
