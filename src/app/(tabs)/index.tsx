import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';

import type { PlanKind } from '@/engine/coach';
import { CHRONOTYPE_LABELS } from '@/engine/chronotype';
import { formatDuration, formatTime, minutesOfDay } from '@/engine/time';
import { useStore } from '@/state/store';
import { runSync } from '@/state/sync';
import { useAnalysis } from '@/state/useAnalysis';
import { EnergyChart, Hypnogram } from '@/ui/charts';
import { Button, Card, CardTitle, Empty, Icon, Meter, Note, Ring, Row, Screen, Section, Stat } from '@/ui/components';
import { dayLabel, greeting, nightLabel, relativeTime } from '@/ui/format';
import { colors, debtColor, font, scoreColor, space } from '@/ui/theme';

const PLAN_ICON: Record<PlanKind, { icon: string; color: string }> = {
  wake: { icon: 'weather-sunset-up', color: colors.energy },
  light: { icon: 'white-balance-sunny', color: colors.energy },
  focus: { icon: 'target', color: colors.good },
  dip: { icon: 'trending-down', color: colors.warn },
  nap: { icon: 'sleep', color: colors.accent },
  caffeine: { icon: 'coffee-off-outline', color: colors.caffeine },
  meal: { icon: 'silverware-fork-knife', color: colors.textDim },
  exercise: { icon: 'run', color: colors.textDim },
  winddown: { icon: 'lightbulb-night-outline', color: colors.light },
  bed: { icon: 'bed', color: colors.accent },
  alarm: { icon: 'alarm', color: colors.energy },
};

export default function Today() {
  const a = useAnalysis();
  const settings = useStore((s) => s.settings);
  const loadDemo = useStore((s) => s.loadDemo);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>();

  const sync = async () => {
    if (settings.dataMode === 'demo') return;
    setSyncing(true);
    const r = await runSync();
    setSyncMsg(r.message);
    setSyncing(false);
  };

  const header = (
    <Row gap={space.sm}>
      {settings.dataMode === 'live' ? (
        <Pressable onPress={sync} accessibilityLabel="Sync now" hitSlop={8}>
          {syncing ? <ActivityIndicator color={colors.accent} /> : <Icon name="sync" size={24} color={colors.textDim} />}
        </Pressable>
      ) : null}
      <Pressable onPress={() => router.push('/settings')} accessibilityLabel="Settings" hitSlop={8}>
        <Icon name="cog-outline" size={24} color={colors.textDim} />
      </Pressable>
    </Row>
  );

  if (!a) {
    return (
      <Screen title="eepy" subtitle={greeting(Date.now())} right={header}>
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

  const last = a.lastNight?.main;
  const score = last ? a.scores[last.id] : undefined;
  const debtCol = debtColor(a.debt.category);
  const chrono = a.chronotype.category ? CHRONOTYPE_LABELS[a.chronotype.category].label : undefined;

  return (
    <Screen
      title={greeting(a.now)}
      subtitle={`${dayLabel(a.day)}${settings.lastSync ? ` · synced ${relativeTime(settings.lastSync)}` : ''}`}
      right={header}
      refreshControl={settings.dataMode === 'live' ? <RefreshControl refreshing={syncing} onRefresh={sync} tintColor={colors.accent} /> : undefined}
    >
      {settings.dataMode === 'demo' ? (
        <Note tone="info" icon="flask-outline">
          Demo data. Connect your watch in Settings → Data sources to switch to your own sleep.
        </Note>
      ) : null}
      {syncMsg ? <Note tone="info">{syncMsg}</Note> : settings.lastSyncError ? <Note tone="warn">{settings.lastSyncError}</Note> : null}
      {!a.lastNightIsCurrent ? (
        <Note tone="warn" icon="watch-import-variant">
          Last night hasn't arrived yet. Open Nothing X to sync your watch, then pull down here. Until then eepy assumes a typical night.
        </Note>
      ) : null}

      {last && score ? (
        <Card onPress={() => router.push({ pathname: '/night/[id]', params: { id: last.id } })}>
          <CardTitle icon="bed-outline" title={nightLabel(a.lastNight!.wakeDate)} right={<Icon name="chevron-right" color={colors.textFaint} />} />
          <Row gap={space.lg}>
            <Ring value={score.total} color={scoreColor(score.total)} size={92}>
              <Text style={[font.stat, { fontSize: 26 }]}>{score.total}</Text>
              <Text style={font.tiny}>{score.label.toUpperCase()}</Text>
            </Ring>
            <View style={{ flex: 1, gap: space.sm }}>
              <Row>
                <Stat label="Asleep" value={formatDuration(last.totalSleepMin)} sub={`need ${formatDuration(a.need.needMin)}`} />
                <Stat label="In bed" value={`${formatTime(last.start)}`} sub={`→ ${formatTime(last.end)}`} />
              </Row>
              {last.stagePct ? (
                <Text style={font.small}>
                  Deep {Math.round(last.stagePct.deep * 100)}% · REM {Math.round(last.stagePct.rem * 100)}% · {last.awakenings} wake-ups
                </Text>
              ) : null}
            </View>
          </Row>
          <View style={{ marginTop: space.md }}>
            <Hypnogram segments={last.segments} start={last.start} end={last.end} height={96} />
          </View>
        </Card>
      ) : null}

      <Row gap={space.md} style={{ alignItems: 'stretch' }}>
        <Card style={{ flex: 1 }} onPress={() => router.push('/need')}>
          <Text style={font.tiny}>SLEEP NEED</Text>
          <Text style={[font.stat, { marginTop: 4 }]}>{formatDuration(a.need.needMin)}</Text>
          <Text style={font.small}>
            {a.need.method === 'override' ? 'set by you' : a.need.method === 'personalized' ? `personalised · ${a.need.confidence} confidence` : 'age-based estimate'}
          </Text>
        </Card>
        <Card style={{ flex: 1 }} onPress={() => router.push('/trends')}>
          <Text style={font.tiny}>SLEEP DEBT</Text>
          <Text style={[font.stat, { marginTop: 4, color: debtCol }]}>{formatDuration(a.debt.debtMin)}</Text>
          <Text style={font.small}>
            {a.debt.category === 'none' ? 'fully rested' : `${a.debt.category}`}
            {a.debt.trendMin !== undefined && Math.abs(a.debt.trendMin) >= 15 ? ` · ${a.debt.trendMin > 0 ? '▲' : '▼'} ${formatDuration(Math.abs(a.debt.trendMin))} this week` : ''}
          </Text>
        </Card>
      </Row>
      {a.debt.payoff ? (
        <Note tone="warn" icon="bed-clock">
          Pay it back: sleep ~{a.debt.payoff.extraMinPerNight} min more for {a.debt.payoff.nights} night{a.debt.payoff.nights > 1 ? 's' : ''}. Tonight's plan already includes it.
        </Note>
      ) : null}

      <Card>
        <CardTitle
          icon="lightning-bolt-outline"
          title="Energy today"
          color={colors.energy}
          right={a.energy.now ? <Text style={[font.h3, { color: colors.energy }]}>{Math.round(a.energy.now.energy)}</Text> : null}
        />
        <EnergyChart
          points={a.energy.points}
          now={a.now}
          dip={a.energy.dip}
          focusWindows={a.energy.focusWindows}
          nap={a.nap.best && a.nap.verdict !== 'skip' ? { start: a.nap.best.start, end: a.nap.best.start + a.nap.best.alarmAfterMin * 60000 } : undefined}
        />
        <Row gap={space.lg} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
          {a.energy.peaks.map((p) => (
            <Text key={p.t} style={font.small}>
              <Text style={{ color: colors.good }}>▲</Text> peak {formatTime(p.t)}
            </Text>
          ))}
          {a.energy.dip ? (
            <Text style={font.small}>
              <Text style={{ color: colors.warn }}>▼</Text> dip {formatTime(a.energy.dip.t)}
            </Text>
          ) : null}
          {chrono ? <Text style={font.small}>· {chrono}</Text> : null}
        </Row>
      </Card>

      <Card onPress={() => router.push('/nap')} accent={a.nap.verdict === 'nap-now' ? colors.accent : undefined}>
        <CardTitle icon="sleep" title="Do I need a nap?" right={<Icon name="chevron-right" color={colors.textFaint} />} />
        <Text style={font.body}>{a.nap.headline}</Text>
        <View style={{ marginTop: space.sm }}>
          <Meter value={a.nap.needScore} color={a.nap.needScore >= 55 ? colors.accent : a.nap.needScore >= 35 ? colors.warn : colors.good} />
          <Text style={[font.tiny, { marginTop: 4 }]}>NAP NEED {a.nap.needScore}/100</Text>
        </View>
      </Card>

      <Card onPress={() => router.push('/plan')}>
        <CardTitle icon="moon-waning-crescent" title="Tonight" right={<Icon name="chevron-right" color={colors.textFaint} />} />
        <Row>
          <Stat label="Wind down" value={formatTime(a.tonight.windDownStart)} />
          <Stat label="Lights out" value={formatTime(a.tonight.bedtime)} color={colors.accent} />
          <Stat label="Alarm" value={formatTime(a.alarm.alarm)} sub={a.alarm.onBoundary ? 'cycle-timed' : undefined} />
        </Row>
        <View style={{ marginTop: space.md }}>
          {a.caffeine.cutoff.cutoff ? (
            <Text style={font.small}>
              ☕ Caffeine cut-off {formatTime(a.caffeine.cutoff.cutoff)}
              {a.caffeine.nowMg >= 5 ? ` · ${Math.round(a.caffeine.nowMg)} mg in your system now` : ''}
            </Text>
          ) : a.caffeine.cutoff.overLimit ? (
            <Text style={[font.small, { color: colors.warn }]}>☕ ~{Math.round(a.caffeine.cutoff.atBedtimeMg)} mg will still be active at bedtime — skip more caffeine today.</Text>
          ) : null}
        </View>
      </Card>

      {a.readiness ? (
        <Card>
          <CardTitle icon="heart-pulse" title="Readiness" color={colors.bad} right={<Text style={[font.h3, { color: scoreColor(a.readiness.score) }]}>{a.readiness.score} · {a.readiness.label}</Text>} />
          {a.readiness.contributors.map((c) => (
            <View key={c.key} style={{ marginBottom: space.sm }}>
              <Row>
                <Text style={[font.small, { flex: 1, color: colors.text }]}>{c.label}</Text>
                <Text style={font.small}>{c.score}</Text>
              </Row>
              <View style={{ marginTop: 4 }}>
                <Meter value={c.score} color={scoreColor(c.score)} height={6} />
              </View>
              <Text style={[font.tiny, { marginTop: 3 }]}>{c.detail}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Section title="Your day">
        <Card>
          {a.plan.map((p, i) => {
            const meta = PLAN_ICON[p.kind];
            const past = (p.end ?? p.time) < a.now && minutesOfDay(p.time) >= 0 && p.kind !== 'alarm';
            return (
              <Row key={p.id} gap={space.md} style={{ alignItems: 'flex-start', paddingVertical: 8, opacity: past ? 0.45 : 1, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <Text style={[font.h3, { width: 50, fontVariant: ['tabular-nums'] }]}>{formatTime(p.time)}</Text>
                <Icon name={meta.icon} color={meta.color} />
                <View style={{ flex: 1 }}>
                  <Text style={font.body}>
                    {p.title}
                    {p.end ? <Text style={font.small}> · until {formatTime(p.end)}</Text> : null}
                  </Text>
                  <Text style={font.small}>{p.detail}</Text>
                </View>
              </Row>
            );
          })}
        </Card>
      </Section>

      <Section title="Coaching">
        {a.tips.slice(0, 3).map((t) => (
          <Card key={t.id}>
            <CardTitle icon={t.icon} title={t.title} />
            <Text style={font.small}>{t.detail}</Text>
          </Card>
        ))}
      </Section>

      {a.insights.length ? (
        <Section title="What affects your sleep" action={<Button small kind="ghost" label="All" onPress={() => router.push('/trends')} />}>
          {a.insights.slice(0, 3).map((i) => (
            <Card key={i.id} accent={i.kind === 'negative' ? colors.warn : i.kind === 'positive' ? colors.good : undefined}>
              <Text style={font.h3}>{i.title}</Text>
              <Text style={[font.small, { marginTop: 4 }]}>{i.detail}</Text>
              {i.evidence ? <Text style={[font.tiny, { marginTop: 6 }]}>{i.evidence}</Text> : null}
            </Card>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
