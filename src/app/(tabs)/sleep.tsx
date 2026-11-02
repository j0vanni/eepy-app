/**
 * Sleep: your history in one place — Trends (charts), Calendar (the month of past nights and
 * coming mornings) and Nights (every night, newest first). Param `view` = trends | calendar | nights.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAnalysis } from '@/state/useAnalysis';
import { Button, Empty, Screen, Segmented } from '@/ui/components';
import { CalendarView } from '@/ui/planner/calendar';
import { NightsList } from '@/ui/sleep/NightsList';
import { TrendsView } from '@/ui/sleep/TrendsView';
import { space } from '@/ui/theme';

type SleepView = 'trends' | 'calendar' | 'nights';
const VIEWS: readonly string[] = ['trends', 'calendar', 'nights'];
const asView = (v: string | undefined): SleepView | undefined => (v && VIEWS.includes(v) ? (v as SleepView) : undefined);

export default function SleepScreen() {
  const a = useAnalysis();
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<SleepView>(() => asView(params.view) ?? 'trends');

  // Opened from search or a link with a view: switch to it once.
  useEffect(() => {
    const v = asView(params.view);
    if (!v) return;
    setView(v);
    // Deferred like the Planner's: on a cold start the navigator may not be mounted yet.
    const id = setTimeout(() => router.setParams({ view: undefined }), 150);
    return () => clearTimeout(id);
  }, [params.view]);

  if (!a) {
    return (
      <Screen title="Sleep" subtitle="Your nights so far">
        <Empty icon="chart-timeline-variant" title="No nights yet" body="Your history fills in as nights arrive from your watch — or log one yourself.">
          <Button label="Log a night" icon="pencil-plus" kind="secondary" onPress={() => router.push('/log-sleep')} />
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen title="Sleep" subtitle="Your nights so far">
      <Segmented<SleepView>
        value={view}
        onChange={setView}
        options={[
          { label: 'Trends', value: 'trends' },
          { label: 'Calendar', value: 'calendar' },
          { label: 'Nights', value: 'nights' },
        ]}
      />
      <View style={{ marginTop: space.md }}>
        {view === 'trends' ? <TrendsView a={a} /> : view === 'calendar' ? <CalendarView a={a} initialDate={a.lastNight?.wakeDate} /> : <NightsList a={a} />}
      </View>
    </Screen>
  );
}
