/**
 * Sleep: how did I sleep. Last night at the top, then the three numbers that sum up the bigger
 * picture (need, debt, this week's average), then every night as a list or as trends.
 *
 * Param `view` = nights | trends opens that half (and scrolls to it); `calendar` opens the month
 * calendar, which used to be a third view here.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollViewInstance, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { mean } from '@/engine/stats';
import { addDays, formatDuration, formatTime } from '@/engine/time';
import { useAnalysis } from '@/state/useAnalysis';
import { Hypnogram } from '@/ui/charts';
import { Banner, Button, Card, Empty, Hero, Icon, Link, Row, Screen, Section, Segmented, Stat } from '@/ui/components';
import { dayLabel, nightLabel } from '@/ui/format';
import { NightsList } from '@/ui/sleep/NightsList';
import { ScoreLine } from '@/ui/sleep/parts';
import { TrendsView } from '@/ui/sleep/TrendsView';
import { colors, debtColor, space } from '@/ui/theme';

type SleepView = 'nights' | 'trends';
const asView = (v: string | undefined): SleepView | undefined => (v === 'nights' || v === 'trends' ? v : undefined);

/** The most recent night: time asleep, the score in words, and the night's shape. Tap for the whole night. */
function LastNight({ a }: { a: Analysis }) {
  const last = a.lastNight?.main;
  if (!last) {
    return (
      <Hero label="Last night" value="Not here yet" caption="Nights appear once your watch has synced. Slept without it? Log the night yourself.">
        <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
          <Button small kind="secondary" icon="pencil-plus" label="Log a night" onPress={() => router.push('/log-sleep')} />
        </View>
      </Hero>
    );
  }
  return (
    <Hero
      // An older night (last night hasn't synced yet) says which one it is.
      label={last.wakeDate === a.day ? 'Last night' : `${nightLabel(last.wakeDate, a.day)} · ${dayLabel(last.wakeDate, a.day)}`}
      value={formatDuration(last.totalSleepMin)}
      caption={<ScoreLine score={a.scores[last.id]} rest={`${formatTime(last.sleepOnset)} – ${formatTime(last.finalWake)}`} />}
      onPress={() => router.push({ pathname: '/night/[id]', params: { id: last.id } })}
      right={<Icon name="chevron-right" size={28} color={colors.textFaint} />}
    >
      <View style={{ marginTop: space.md }}>
        <Hypnogram segments={last.segments} start={last.start} end={last.end} height={120} />
      </View>
    </Hero>
  );
}

/** Need, debt and the last week's average in one row; the panel opens the sleep-need screen. */
function BigPicture({ a }: { a: Analysis }) {
  const need = a.need.needMin;
  const week = a.nights.filter((n) => n.main && n.wakeDate > addDays(a.day, -7) && n.wakeDate <= a.day);
  const avg = week.length ? mean(week.map((n) => n.totalSleepMin)) : undefined;
  const noDebt = a.debt.category === 'none';
  return (
    <Card onPress={() => router.push('/need')}>
      <Row gap={space.sm}>
        <Stat label="Sleep need" value={formatDuration(need)} sub="a night" />
        <Stat label="Sleep debt" value={noDebt ? 'None' : formatDuration(a.debt.debtMin)} color={debtColor(a.debt.category)} sub={noDebt ? undefined : a.debt.category} />
        <Stat
          label="7-night average"
          value={avg !== undefined ? formatDuration(avg) : '–'}
          sub={avg === undefined ? 'no nights yet' : week.length < 7 ? `${week.length} of 7 nights` : avg < need - 10 ? `${formatDuration(need - avg)} short` : 'enough'}
        />
        <Icon name="chevron-right" color={colors.textFaint} />
      </Row>
    </Card>
  );
}

export default function SleepScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<SleepView>(() => asView(params.view) ?? 'nights');
  const scrollRef = useRef<ScrollViewInstance>(null);
  const historyY = useRef(0);
  // The month calendar opens on last night, as the Calendar view here used to.
  const lastDate = a?.lastNight?.wakeDate;
  const openCalendar = () => router.push(lastDate ? { pathname: '/calendar', params: { date: lastDate } } : '/calendar');

  // Opened from search or a link with a view: switch to it once and bring it into view.
  useEffect(() => {
    const wanted = params.view;
    if (!wanted) return;
    const v = asView(wanted);
    if (v) setView(v);
    // Deferred like the Planner's: on a cold start the navigator may not be mounted yet.
    const id = setTimeout(() => {
      router.setParams({ view: undefined });
      if (wanted === 'calendar') openCalendar();
      else if (v) scrollRef.current?.scrollTo({ y: historyY.current, animated: false });
    }, 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.view]);

  if (!a) {
    return (
      <Screen title="Sleep">
        <Empty icon="moon-waning-crescent" title="No nights yet" body="Your nights appear here as they arrive from your watch — or log one yourself.">
          <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
            <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
            <Button label="Log a night" icon="pencil-plus" kind="secondary" onPress={() => router.push('/log-sleep')} />
          </View>
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen title="Sleep" scrollRef={scrollRef}>
      {a.lastNight?.main && !a.lastNightIsCurrent ? (
        <Banner tone="warn" icon="watch-import-variant" text="Last night hasn't arrived yet. Sync your watch in Nothing X, or log the night yourself." action="Log it" onAction={() => router.push('/log-sleep')} />
      ) : null}
      <LastNight a={a} />
      <BigPicture a={a} />
      <View onLayout={(e) => (historyY.current = e.nativeEvent.layout.y)}>
        <Section title="Every night" action={<Link label="Month calendar" onPress={openCalendar} />}>
          <Segmented<SleepView>
            value={view}
            onChange={setView}
            options={[
              { label: 'Nights', value: 'nights' },
              { label: 'Trends', value: 'trends' },
            ]}
          />
          <View style={{ marginTop: space.md }}>{view === 'nights' ? <NightsList a={a} /> : <TrendsView a={a} />}</View>
        </Section>
      </View>
    </Screen>
  );
}
