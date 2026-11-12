/**
 * More: every tool and setting in one list under plain headings, with a search box that also finds
 * single settings.
 */
import { Href, router } from 'expo-router';
import { useMemo, useState } from 'react';

import { cbtiStatus, CBTI_WEEKS } from '@/engine/cbti';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { ListCard, ListRow, Screen, Section } from '@/ui/components';
import { FeatureSearch } from '@/ui/FeatureSearch';
import { SelfChecksCard } from '@/ui/settings/SelfChecks';

interface Item {
  icon: string;
  title: string;
  sub?: string;
  href: Href;
}

function Group({ title, items }: { title: string; items: Item[] }) {
  return (
    <Section title={title}>
      <ListCard>
        {items.map((i) => (
          <ListRow key={i.title} icon={i.icon} title={i.title} sub={i.sub} onPress={() => router.push(i.href)} />
        ))}
      </ListCard>
    </Section>
  );
}

export default function MoreScreen() {
  const a = useAnalysis();
  const program = useStore((s) => s.cbti);
  const calibration = useStore((s) => s.calibration);
  const [searching, setSearching] = useState(false);
  const cbti = useMemo(() => (a && program?.active ? cbtiStatus(program, a.nights, a.day) : undefined), [a, program]);

  return (
    <Screen title="More">
      <FeatureSearch onSearchingChange={setSearching} />
      {searching ? null : (
        <>
          <Group
            title="Energy"
            items={[
              { icon: 'lightning-bolt-outline', title: 'Energy', sub: calibration?.accuracy !== undefined ? `Why the number is what it is · ${calibration.accuracy}% accurate` : 'Why the number is what it is, and what your watch adds', href: '/energy' },
              { icon: 'gesture-tap', title: 'Reaction test', sub: 'One minute, an objective check on your alertness', href: '/reaction' },
              { icon: 'emoticon-happy-outline', title: 'Check in', sub: 'How alert you feel, plus tags for the day', href: '/checkin' },
              { icon: 'sleep', title: 'Nap', sub: 'Should you nap, when, and for how long', href: '/nap' },
              { icon: 'coffee-outline', title: 'Caffeine', sub: 'Log a drink at the time you had it', href: '/caffeine' },
            ]}
          />
          <Group
            title="Sleep"
            items={[
              { icon: 'scale-balance', title: 'Sleep need and debt', sub: 'How much you need, and how sure eepy is', href: '/need' },
              { icon: 'weather-night', title: 'Wind-down', sub: 'Your evening steps, breathing and sleep sounds', href: '/winddown' },
              { icon: 'tune-variant', title: 'What if?', sub: 'Try a bedtime, nap or coffee and see tomorrow', href: '/simulate' },
              { icon: 'notebook-outline', title: 'Journal', sub: 'Tags, ratings and drinks, day by day', href: '/journal' },
              { icon: 'pencil-plus-outline', title: 'Log a night yourself', sub: 'For nights without the watch', href: '/log-sleep' },
            ]}
          />
          <Group
            title="Coach"
            items={[
              { icon: 'account-heart-outline', title: 'Coach', sub: 'Your experiment, goals and this week', href: '/coach' },
              { icon: 'flask-outline', title: 'Experiments', sub: 'Test what really changes your sleep', href: '/experiments' },
              { icon: 'flag-checkered', title: 'Goals', sub: 'Small daily wins, one day at a time', href: '/goals' },
              { icon: 'calendar-week', title: 'Weekly review', sub: 'Your week in sleep, every Sunday', href: '/review' },
              {
                icon: 'bed-clock',
                title: 'Insomnia programme',
                sub: cbti ? `Week ${cbti.week}${cbti.maintenance ? ', maintenance' : ` of ${CBTI_WEEKS}`}` : 'Six weeks for trouble sleeping',
                href: '/cbti',
              },
              { icon: 'airplane-clock', title: 'Jet lag', sub: 'A day-by-day plan for crossing time zones', href: '/jetlag' },
            ]}
          />
          <Section title="Self-checks">
            <SelfChecksCard />
          </Section>
          <Group
            title="App"
            items={[
              { icon: 'cog-outline', title: 'Settings', sub: 'Alarms, reminders, sounds, caffeine, your schedule', href: '/settings' },
              { icon: 'watch-variant', title: 'Watch and data', sub: 'Sync, backup, export', href: { pathname: '/settings/[section]', params: { section: 'data' } } },
              { icon: 'file-chart-outline', title: 'Reports', sub: 'A PDF for you or your doctor, a CSV of every night', href: '/export' },
              { icon: 'cellphone-arrow-down', title: 'App updates', href: '/updates' },
              { icon: 'gift-outline', title: "What's new", href: '/whats-new' },
            ]}
          />
        </>
      )}
    </Screen>
  );
}
