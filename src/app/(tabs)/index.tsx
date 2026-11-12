/**
 * Today: one thing at the top (it depends on the time of day), the actions you take most, what is
 * next, and a short list that leads to everything else about today.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useContext, useState } from 'react';
import { ActivityIndicator, RefreshControl, View } from 'react-native';

import type { Analysis } from '@/engine/analysis';
import { curvePosition, dayPhase, phaseInputFor } from '@/engine/dayPhase';
import { isOpen } from '@/engine/inBed';
import { formatDuration, formatTime } from '@/engine/time';
import { nowAfterUp, upEarlyAt } from '@/state/earlyUp';
import { sessionFor } from '@/state/inBed';
import { useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { CalendarNote } from '@/ui/cards/CalendarNote';
import { CbtiCard } from '@/ui/cards/CbtiCard';
import { RoutineMorningNow } from '@/ui/cards/RoutineMorningNow';
import { UpdateBanner } from '@/ui/cards/UpdateBanner';
import { Banner, Button, Empty, IconButton, ListCard, ListRow, Row, Screen, Section, Timeline } from '@/ui/components';
import { fullDate, relativeTime } from '@/ui/format';
import { NightChromeContext } from '@/ui/nightChrome';
import { colors, debtColor, scoreColor, space } from '@/ui/theme';
import { EarlyUpCard, earlyUpShows } from '@/ui/today/EarlyUp';
import { DayHero, energyReasons, EveningHero, MorningHero, NightMoreToggle, NightView } from '@/ui/today/heroes';
import { UpCard } from '@/ui/today/InBed';
import { QuickActions } from '@/ui/today/QuickActions';
import { upNext } from '@/ui/today/upNext';
import { UsualCoffee } from '@/ui/today/UsualCoffee';

/** The rows under "Today": one line each, leading to the screen that has the whole story. */
function TodayRows({ a, now, phase }: { a: Analysis; now: number; phase: 'morning' | 'day' | 'evening' | 'night' }) {
  const pos = curvePosition(a.energy, now);
  const last = a.lastNight?.main;
  const score = last ? a.scores[last.id] : undefined;
  const cut = a.caffeine.cutoff;
  const caffeineSub = cut.overLimit
    ? `About ${Math.round(cut.atBedtimeMg)} mg will still be active at lights-out`
    : cut.cutoff
      ? cut.cutoff > now
        ? `Last coffee by ${formatTime(cut.cutoff)}`
        : `Past today's cut-off (${formatTime(cut.cutoff)})`
      : undefined;
  return (
    <ListCard>
      {phase !== 'day' && pos ? (
        <ListRow
          icon="lightning-bolt-outline"
          iconColor={colors.energy}
          title={`Energy ${Math.round(pos.energy)}`}
          sub={energyReasons(a) ?? (a.energy.peaks.length ? `Peaks around ${a.energy.peaks.map((p) => formatTime(p.t)).join(' and ')}` : undefined)}
          onPress={() => router.push('/energy')}
        />
      ) : null}
      {phase !== 'morning' && last && score ? (
        <ListRow
          icon="bed-outline"
          iconColor={colors.sleep}
          title={`Slept ${formatDuration(last.totalSleepMin)}`}
          sub={`Score ${score.total} · ${score.label.toLowerCase()}`}
          value={undefined}
          onPress={() => router.push({ pathname: '/night/[id]', params: { id: last.id } })}
        />
      ) : null}
      <ListRow
        icon="scale-balance"
        iconColor={debtColor(a.debt.category)}
        title={a.debt.category === 'none' ? 'No sleep debt' : `Sleep debt ${formatDuration(a.debt.debtMin)}`}
        sub={a.debt.payoff ? `Pay it back: about ${a.debt.payoff.extraMinPerNight} min more for ${a.debt.payoff.nights} night${a.debt.payoff.nights > 1 ? 's' : ''}` : `You need ${formatDuration(a.need.needMin)} a night`}
        onPress={() => router.push('/need')}
      />
      {phase !== 'night' ? <ListRow icon="sleep" title="Nap" sub={a.nap.headline} onPress={() => router.push('/nap')} /> : null}
      <ListRow
        icon="coffee-outline"
        iconColor={colors.caffeine}
        title={a.caffeine.nowMg >= 5 ? `Caffeine ${Math.round(a.caffeine.nowMg)} mg` : 'Caffeine'}
        sub={caffeineSub}
        onPress={() => router.push('/caffeine')}
      />
      {a.readiness ? (
        <ListRow
          icon="heart-pulse"
          iconColor={scoreColor(a.readiness.score)}
          title={`Recovery ${a.readiness.score}`}
          sub={`${a.readiness.label} · from last night's heart rate, HRV and sleep`}
          onPress={() => router.push('/energy')}
        />
      ) : null}
    </ListCard>
  );
}

export default function Today() {
  const a = useAnalysis();
  const clock = useNow(30_000);
  const settings = useStore((s) => s.settings);
  // Never before an "I'm up" just tapped, so Today switches to the morning right away.
  const now = nowAfterUp(settings, clock);
  const profile = useStore((s) => s.profile);
  const loadDemo = useStore((s) => s.loadDemo);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>();
  const [nightMore, setNightMore] = useState(false);
  const setNightChrome = useContext(NightChromeContext);
  const session = useStore((s) => s.settings.session);
  // In bed ("I'm in bed") a little before lights-out is night too: the calm view, the tab bar dimmed.
  const inBed = !!a && isOpen(sessionFor(session, a));
  const phaseNow = a ? dayPhase(now, phaseInputFor(a, profile, upEarlyAt(settings, now))) : undefined;
  // Known before the early return below, so the hook order never changes.
  const nightNow = phaseNow === 'night' || (inBed && phaseNow === 'evening');
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
      <Screen title="eepy" right={header}>
        <Empty icon="watch-variant" title="Connect your watch" body="eepy reads the sleep, heart rate and steps your CMF Watch shares through Nothing X and Health Connect.">
          <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
            <Button label="Connect watch" icon="link-variant" onPress={() => router.push('/connect')} />
            <Button label="Log a night yourself" icon="pencil" kind="secondary" onPress={() => router.push('/log-sleep')} />
            <Button label="Look around with demo data" kind="ghost" onPress={() => loadDemo()} />
          </View>
        </Empty>
        {settings.lastSyncError ? <Banner tone="warn" text={settings.lastSyncError} /> : null}
      </Screen>
    );
  }

  const input = phaseInputFor(a, profile, upEarlyAt(settings, now));
  // Woke before the alarm: "I'm up" (that also turns this morning's alarms off), then "Up at …" with Undo.
  const earlyUp = earlyUpShows(a, settings, profile, now);
  const phase = dayPhase(now, input);
  const night = phase === 'night' || (inBed && phase === 'evening');
  const preDawn = night && now < input.bedtime && phase === 'night';

  // One message at most, the most useful one.
  const banner = syncMsg ? (
    <Banner text={syncMsg} />
  ) : settings.lastSyncError ? (
    <Banner tone="warn" text={settings.lastSyncError} action="Fix" onAction={() => router.push('/connect')} />
  ) : !a.lastNightIsCurrent ? (
    <Banner tone="warn" icon="watch-import-variant" text="Last night hasn't arrived. Open Nothing X to sync your watch, then pull down here." />
  ) : settings.dataMode === 'demo' ? (
    <Banner icon="flask-outline" text="This is demo data." action="Use my watch" onAction={() => router.push('/connect')} />
  ) : null;

  const steps = upNext(a, now);
  const rest = (
    <>
      {steps.length ? (
        <Section title="Up next">
          <Timeline items={steps.map(({ href, kind: _kind, ...item }) => ({ ...item, onPress: href ? () => router.push(href) : undefined }))} />
        </Section>
      ) : null}
      <Section title="Today">
        <TodayRows a={a} now={now} phase={night ? 'night' : phase} />
      </Section>
      <CbtiCard analysis={a} />
      {phase !== 'evening' ? <CalendarNote analysis={a} /> : null}
    </>
  );

  return (
    <Screen
      title={night ? (inBed ? 'Good night' : preDawn ? 'Still night' : 'Up late') : 'Today'}
      subtitle={`${fullDate(a.day)}${settings.lastSync ? ` · synced ${relativeTime(settings.lastSync, now)}` : ''}`}
      right={header}
      tone={night ? 'night' : 'default'}
      refreshControl={settings.dataMode === 'live' ? <RefreshControl refreshing={syncing} onRefresh={sync} tintColor={colors.accent} /> : undefined}
    >
      {night ? (
        <>
          <RoutineMorningNow a={a} />
          {earlyUp ? <EarlyUpCard a={a} now={now} night /> : null}
          <NightView a={a} now={now} input={input} />
          {a.recoveryAlert ? <Banner tone={a.recoveryAlert.level === 'warning' ? 'bad' : 'warn'} icon="heart-pulse" text={a.recoveryAlert.title} onPress={() => router.push('/energy')} /> : null}
          <NightMoreToggle open={nightMore} onToggle={() => setNightMore(!nightMore)} />
          {nightMore ? <View style={{ opacity: 0.8 }}>{rest}</View> : null}
        </>
      ) : (
        <>
          <UpdateBanner />
          {banner}
          {a.recoveryAlert ? <Banner tone={a.recoveryAlert.level === 'warning' ? 'bad' : 'warn'} icon="heart-pulse" text={a.recoveryAlert.title} action="Details" onAction={() => router.push('/energy')} /> : null}
          <RoutineMorningNow a={a} />
          {/* Still in bed from last night: "I'm up" first — before the alarm, the one that also turns it off. */}
          {earlyUp ? <EarlyUpCard a={a} now={now} /> : <UpCard a={a} />}
          {/* Keyed by phase so the hero re-enters when the day moves on. */}
          <View key={phase}>{phase === 'morning' ? <MorningHero a={a} now={now} /> : phase === 'day' ? <DayHero a={a} now={now} /> : <EveningHero a={a} now={now} />}</View>
          <QuickActions phase={phase} a={a} now={now} />
          {phase !== 'evening' ? <UsualCoffee /> : null}
          {rest}
        </>
      )}
    </Screen>
  );
}
