import { router, useFocusEffect } from 'expo-router';
import { useCallback, useContext, useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import { dayPhase, DayPhase, phaseInputFor } from '@/engine/dayPhase';
import { isOpen } from '@/engine/inBed';
import { sessionFor } from '@/state/inBed';
import { useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { CalendarNote } from '@/ui/cards/CalendarNote';
import { CbtiCard } from '@/ui/cards/CbtiCard';
import { ExperimentCard, GoalsCard, RecoveryAlertCard, WeeklyReviewCard } from '@/ui/cards/CoachCards';
import { LearningCard } from '@/ui/cards/LearningCard';
import { SimulatorCard } from '@/ui/cards/SimulatorCard';
import { UpdateBanner } from '@/ui/cards/UpdateBanner';
import { Button, Empty, IconButton, Note, Row, Screen } from '@/ui/components';
import { dayLabel, greeting, relativeTime } from '@/ui/format';
import { colors, space } from '@/ui/theme';
import {
  CoachingSection,
  EnergyCard,
  InsightsSection,
  LastNightCard,
  NapCard,
  NeedDebtRow,
  PlanSection,
  ReadinessCard,
  SleepPressureCard,
  TonightCard,
} from '@/ui/today/cards';
import { DayHero, EveningHero, MorningHero, NightMoreToggle, NightView } from '@/ui/today/heroes';
import { UpCard } from '@/ui/today/InBed';
import { QuickActions } from '@/ui/today/QuickActions';
import { RoutineMorningNow } from '@/ui/cards/RoutineMorningNow';
import { NightChromeContext } from '@/ui/QuickCheckInButton';

const PHASE_LABEL: Record<DayPhase, string> = { morning: 'morning', day: 'daytime', evening: 'evening', night: 'night' };

export default function Today() {
  const a = useAnalysis();
  const now = useNow(30_000);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const loadDemo = useStore((s) => s.loadDemo);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>();
  const [nightMore, setNightMore] = useState(false);
  const setNightChrome = useContext(NightChromeContext);
  const session = useStore((s) => s.settings.session);
  // In bed ("I'm in bed") a little before lights-out is night too: the calm view, the + and tab bar dimmed.
  const inBed = !!a && isOpen(sessionFor(session, a));
  const phaseNow = a ? dayPhase(now, phaseInputFor(a, profile)) : undefined;
  // Known before the early return below, so the hook order never changes.
  const nightNow = phaseNow === 'night' || (inBed && phaseNow === 'evening');
  // While the night view is on screen, the floating button and tab bar dim too.
  useFocusEffect(
    useCallback(() => {
      setNightChrome(nightNow);
      return () => setNightChrome(false);
    }, [nightNow, setNightChrome]),
  );

  const sync = async () => {
    if (settings.dataMode === 'demo') return;
    setSyncing(true);
    const r = await runSync();
    setSyncMsg(r.message);
    setSyncing(false);
  };

  const header = (
    <Row gap={0} style={{ marginRight: -space.sm }}>
      <IconButton icon="notebook-edit-outline" label="Journal" onPress={() => router.push('/journal')} />
      {settings.dataMode === 'live' ? (
        <IconButton icon="sync" label="Sync now" onPress={sync}>
          {syncing ? <ActivityIndicator color={colors.accent} /> : undefined}
        </IconButton>
      ) : null}
      <IconButton icon="cog-outline" label="Settings" onPress={() => router.push('/settings')} />
    </Row>
  );

  if (!a) {
    return (
      <Screen title="eepy" subtitle={greeting(now)} right={header}>
        <Empty icon="watch-variant" title="Connect your CMF Watch" body="eepy reads the sleep stages, heart rate, HRV and blood oxygen your CMF Watch 3 Pro shares through Nothing X and Health Connect.">
          <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
            <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
            <Button label="Log a night manually" icon="pencil" kind="secondary" onPress={() => router.push('/log-sleep')} />
            <Button label="Explore with demo data" icon="flask-outline" kind="ghost" onPress={() => loadDemo()} />
          </View>
        </Empty>
        {settings.lastSyncError ? <Note tone="warn">{settings.lastSyncError}</Note> : null}
      </Screen>
    );
  }

  const input = phaseInputFor(a, profile);
  const phase = dayPhase(now, input);
  const night = phase === 'night' || (inBed && phase === 'evening');
  const preDawn = night && now < input.bedtime && phase === 'night';

  const notes = (
    <>
      {!night ? <UpdateBanner /> : null}
      {settings.dataMode === 'demo' && !night ? (
        <Note tone="info" icon="flask-outline">
          Demo data. To use your own sleep, connect your watch in Settings → Health Connect & data.
        </Note>
      ) : null}
      {syncMsg ? <Note tone="info">{syncMsg}</Note> : settings.lastSyncError ? <Note tone="warn">{settings.lastSyncError}</Note> : null}
      {!a.lastNightIsCurrent && !night ? (
        <Note tone="warn" icon="watch-import-variant">
          Last night hasn't arrived yet. Open Nothing X to sync your watch, then pull down here. Until then eepy assumes a typical night.
        </Note>
      ) : null}
    </>
  );

  // Everything that isn't in the hero, in a fixed order, so every section stays reachable.
  const body = (
    <>
      <CbtiCard analysis={a} />
      {phase !== 'morning' ? <LastNightCard a={a} /> : null}
      <NeedDebtRow a={a} />
      {phase !== 'evening' ? <SleepPressureCard a={a} now={now} /> : null}
      {phase !== 'day' ? <EnergyCard a={a} now={now} /> : null}
      <LearningCard analysis={a} />
      {phase !== 'day' ? <NapCard a={a} /> : null}
      {phase !== 'evening' ? (
        <>
          <TonightCard a={a} now={now} />
          <CalendarNote analysis={a} />
        </>
      ) : null}
      <SimulatorCard analysis={a} />
      <ReadinessCard a={a} />
      <GoalsCard analysis={a} />
      <ExperimentCard analysis={a} />
      <WeeklyReviewCard analysis={a} />
      <PlanSection a={a} now={now} />
      <CoachingSection a={a} />
      <InsightsSection a={a} />
    </>
  );

  return (
    <Screen
      title={night ? (inBed ? 'Good night' : preDawn ? 'Still night' : 'Up late') : greeting(now)}
      subtitle={`${night ? (inBed ? 'Sleep session' : preDawn ? 'Early morning' : 'Tonight') : `${dayLabel(a.day)} · ${PHASE_LABEL[phase]}`}${settings.lastSync ? ` · synced ${relativeTime(settings.lastSync, now)}` : ''}`}
      right={header}
      tone={night ? 'night' : 'default'}
      refreshControl={settings.dataMode === 'live' ? <RefreshControl refreshing={syncing} onRefresh={sync} tintColor={colors.accent} /> : undefined}
    >
      {notes}
      {night ? (
        <>
          <RoutineMorningNow a={a} />
          <NightView a={a} now={now} input={input} />
          <RecoveryAlertCard analysis={a} />
          <NightMoreToggle open={nightMore} onToggle={() => setNightMore(!nightMore)} />
          {nightMore ? <View style={{ opacity: 0.8 }}>{body}</View> : null}
        </>
      ) : (
        <>
          <RoutineMorningNow a={a} />
          {/* Still in bed from last night: "I'm up" first. */}
          <UpCard a={a} />
          <QuickActions phase={phase} a={a} now={now} />
          <RecoveryAlertCard analysis={a} />
          {/* Keyed by phase so the hero re-enters when the day moves on. */}
          <View key={phase}>
            {phase === 'morning' ? <MorningHero a={a} now={now} /> : phase === 'day' ? <DayHero a={a} now={now} /> : <EveningHero a={a} now={now} />}
          </View>
          {body}
        </>
      )}
    </Screen>
  );
}
