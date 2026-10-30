import { useState } from 'react';
import { Text, View } from 'react-native';

import type { NapOption, UpcomingDemand } from '@/engine/nap';
import { dateKey, formatTime } from '@/engine/time';
import { startNapTimer } from '@/notifications/alarms';
import { stopNapTimer } from '@/notifications/napTimer';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { Button, Card, CardTitle, Chip, Empty, Icon, Meter, Note, Ring, Row, Screen, Section } from '@/ui/components';
import { countdown } from '@/ui/format';
import { colors, font, space } from '@/ui/theme';

const KSS = [
  { v: 1, l: 'Extremely alert' },
  { v: 3, l: 'Alert' },
  { v: 5, l: 'Neither' },
  { v: 6, l: 'Some signs of sleepiness' },
  { v: 7, l: 'Sleepy, no effort to stay awake' },
  { v: 8, l: 'Sleepy, some effort' },
  { v: 9, l: 'Fighting sleep' },
];

const DEMANDS: { kind?: UpcomingDemand; label: string; icon: string }[] = [
  { label: 'Nothing special', icon: 'check' },
  { kind: 'long-drive', label: 'Long drive', icon: 'car' },
  { kind: 'night-shift', label: 'Night shift', icon: 'briefcase-clock-outline' },
  { kind: 'late-night', label: 'Late night out', icon: 'party-popper' },
];

const VERDICT_COLOR = { 'nap-now': colors.accent, 'nap-later': colors.info, optional: colors.warn, skip: colors.good };
const VERDICT_TITLE = { 'nap-now': 'Nap now', 'nap-later': 'Nap later', optional: 'Optional', skip: 'Skip it' };

export default function NapScreen() {
  const a = useAnalysis();
  const now = useNow(1000);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const logDay = useStore((s) => s.logDay);
  const sleepiness = useStore((s) => s.dayLogs[dateKey(Date.now())]);
  const [showScience, setShowScience] = useState(false);

  if (!a) {
    return (
      <Screen title="Nap coach">
        <Empty icon="sleep" title="No sleep data yet" body="Connect your watch or log a night so eepy can work out whether you need a nap." />
      </Screen>
    );
  }

  const timer = settings.napTimer;
  const today = dateKey(now);
  const upcoming = settings.upcoming?.date === today ? settings.upcoming.kind : undefined;
  const recentKss = sleepiness?.sleepinessAt && now - sleepiness.sleepinessAt < 3 * 3600_000 ? sleepiness.sleepiness : undefined;

  // Alarm + a pinned "Napping · alarm at …" card; both are cleared when the nap is stopped.
  const start = (o: NapOption) => startNapTimer(useStore.getState(), o);
  const stop = (log: boolean) => stopNapTimer(useStore.getState(), log);

  const verdictColor = VERDICT_COLOR[a.nap.verdict];
  return (
    <Screen title="Nap coach" subtitle="Should you nap, when, and for how long?">
      {timer ? (
        <Card accent={colors.accent} style={{ alignItems: 'center' }}>
          <Text style={font.tiny}>{timer.label.toUpperCase()}</Text>
          <Ring value={Math.min(1, (now - timer.start) / (timer.alarmAt - timer.start)) * 100} size={170} stroke={12}>
            <Text style={[font.stat, { fontSize: 38 }]}>{countdown(timer.alarmAt - now)}</Text>
            <Text style={font.small}>{timer.backupAt ? `watch ${formatTime(timer.alarmAt)} · phone ${formatTime(timer.backupAt)}` : `alarm ${formatTime(timer.alarmAt)}`}</Text>
          </Ring>
          <Text style={[font.small, { textAlign: 'center', marginVertical: space.md }]}>
            {now < timer.alarmAt
              ? 'Lie down somewhere dark and quiet. Even if you only doze, you still benefit.'
              : 'Time to get up! Get some light and move around for a few minutes.'}
          </Text>
          <Row>
            <Button label="I'm up — log nap" icon="check" onPress={() => stop(true)} />
            <Button label="Cancel" kind="ghost" onPress={() => stop(false)} />
          </Row>
        </Card>
      ) : null}

      <Card accent={verdictColor}>
        <Row gap={space.md}>
          <Ring value={a.nap.needScore} color={verdictColor} size={84}>
            <Text style={[font.h2]}>{a.nap.needScore}</Text>
            <Text style={font.tiny}>NEED</Text>
          </Ring>
          <View style={{ flex: 1 }}>
            <Text style={[font.h2, { color: verdictColor }]}>{VERDICT_TITLE[a.nap.verdict]}</Text>
            <Text style={[font.body, { marginTop: 4 }]}>{a.nap.headline}</Text>
          </View>
        </Row>
        {a.nap.window ? (
          <Text style={[font.small, { marginTop: space.md }]}>
            Best window today: {formatTime(a.nap.window.start)}–{formatTime(a.nap.window.end)} · finish by {formatTime(a.nap.latestEnd)}
          </Text>
        ) : null}
      </Card>

      {a.nap.reasons.length ? (
        <Section title="Why">
          {a.nap.reasons.map((r) => (
            <Row key={r} gap={space.sm} style={{ marginBottom: 6, alignItems: 'flex-start' }}>
              <Icon name="circle-small" color={colors.accent} />
              <Text style={[font.body, { flex: 1 }]}>{r}</Text>
            </Row>
          ))}
        </Section>
      ) : null}

      <Section title="How sleepy are you right now?">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {KSS.map((k) => (
            <Chip key={k.v} label={`${k.v} · ${k.l}`} selected={recentKss === k.v} onPress={() => logDay(today, { sleepiness: k.v, sleepinessAt: Date.now() })} />
          ))}
        </View>
        <Text style={[font.tiny, { marginTop: 6 }]}>Karolinska Sleepiness Scale. Your answer counts for 3 hours.</Text>
      </Section>

      <Section title="Anything demanding later today?">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {DEMANDS.map((d) => (
            <Chip
              key={d.label}
              label={d.label}
              icon={d.icon}
              selected={upcoming === d.kind}
              onPress={() => setSettings({ upcoming: d.kind ? { kind: d.kind, date: today } : undefined })}
            />
          ))}
        </View>
      </Section>

      <Section title="Options">
        {a.nap.options.map((o) => (
          <Card key={o.type} accent={a.nap.best?.type === o.type && a.nap.verdict !== 'skip' ? colors.accent : undefined} style={{ opacity: o.suitable ? 1 : 0.6 }}>
            <CardTitle
              icon={{ power: 'flash', coffee: 'coffee', recovery: 'autorenew', prophylactic: 'shield-moon' }[o.type]}
              title={`${o.label} · ${o.alarmAfterMin} min`}
              right={a.nap.best?.type === o.type && a.nap.verdict !== 'skip' ? <Text style={[font.tiny, { color: colors.accent }]}>BEST</Text> : null}
            />
            <Text style={font.small}>{o.description}</Text>
            <Row gap={space.lg} style={{ marginTop: space.sm }}>
              <Text style={font.small}>
                Energy after: <Text style={{ color: o.energyGain > 0 ? colors.good : colors.textDim }}>{o.energyGain > 0 ? '+' : ''}{o.energyGain}</Text>
              </Text>
              <Text style={font.small}>
                Bedtime impact: <Text style={{ color: o.bedtimeDelayMin > 30 ? colors.warn : colors.textDim }}>{o.bedtimeDelayMin ? `~${o.bedtimeDelayMin} min later` : 'none'}</Text>
              </Text>
            </Row>
            {o.why ? <Text style={[font.small, { color: colors.warn, marginTop: 6 }]}>{o.why}</Text> : null}
            {o.suitable && !timer ? (
              <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
                <Button small icon="alarm" label={`Start ${o.alarmAfterMin}-min nap`} onPress={() => start(o)} />
              </View>
            ) : null}
          </Card>
        ))}
      </Section>

      <Section title="Good to know">
        {a.nap.cautions.map((c) => (
          <Note key={c} tone="warn">
            {c}
          </Note>
        ))}
        <Card onPress={() => setShowScience(!showScience)}>
          <CardTitle icon="flask-outline" title="How eepy decides" right={<Icon name={showScience ? 'chevron-up' : 'chevron-down'} />} />
          {showScience ? (
            <View style={{ gap: space.sm }}>
              <Text style={font.small}>
                Nap need combines your 14-night sleep debt, last night's shortfall against your personal sleep need, your predicted energy (a three-process model of
                sleep pressure, body clock and sleep inertia), how sleepy you say you feel, and anything demanding coming up.
              </Text>
              <Text style={font.small}>
                Timing targets your circadian afternoon dip. Each option is simulated: the energy gain is the average change over the 3 hours after waking, and the
                bedtime impact is how much the nap lowers your sleep pressure below its normal bedtime level (two-process model).
              </Text>
              <Text style={font.small}>
                Short naps (10–20 min) stay in light sleep, so you wake up sharp. A full ~{a.cycleMin}-minute cycle lets you finish deep and REM sleep and wake from light
                sleep. In between, you are likely to wake from deep sleep — that's the groggy "sleep inertia" zone.
              </Text>
            </View>
          ) : null}
        </Card>
      </Section>
    </Screen>
  );
}
