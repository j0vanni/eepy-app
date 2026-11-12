/**
 * Nap: should you nap, when, and for how long. The verdict in a few words, the recommended nap as
 * the one button (it starts the timer and the alarm), the other naps as rows with what each gains
 * and costs. A running nap takes over the top of the screen. Under that: what eepy should know
 * about today, a nap you already took, and the reasoning, folded away.
 */
import { Text, View } from 'react-native';

import type { NapOption, UpcomingDemand } from '@/engine/nap';
import { dateKey, formatTime, MINUTE } from '@/engine/time';
import { startNapTimer } from '@/notifications/alarms';
import { stopNapTimer } from '@/notifications/napTimer';
import { useStore } from '@/state/store';
import { useAnalysis, useNow } from '@/state/useAnalysis';
import { Lines } from '@/ui/coach/parts';
import { Button, Chip, Empty, Fold, Hero, KeyValue, ListCard, Meter, Screen, Section } from '@/ui/components';
import { countdown } from '@/ui/format';
import { NumberScale } from '@/ui/learning/QuickCheckIn';
import { NapLogCard } from '@/ui/NapLog';
import { colors, font, space } from '@/ui/theme';

const DEMANDS: { kind?: UpcomingDemand; label: string; icon: string }[] = [
  { label: 'Nothing special', icon: 'check' },
  { kind: 'long-drive', label: 'Long drive', icon: 'car' },
  { kind: 'night-shift', label: 'Night shift', icon: 'briefcase-clock-outline' },
  { kind: 'late-night', label: 'Late night out', icon: 'party-popper' },
];

const OPTION_ICON: Record<NapOption['type'], string> = { power: 'flash-outline', coffee: 'coffee-outline', recovery: 'autorenew', prophylactic: 'shield-moon-outline' };

/** What a nap gains and what it costs tonight. */
const tradeOff = (o: NapOption) =>
  `Energy ${o.energyGain > 0 ? '+' : ''}${o.energyGain} · ${o.bedtimeDelayMin ? `sleepy about ${o.bedtimeDelayMin} min later tonight` : 'no cost at bedtime'}`;

export default function NapScreen() {
  const a = useAnalysis();
  const now = useNow(1000);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const logDay = useStore((s) => s.logDay);
  const dayLog = useStore((s) => s.dayLogs[dateKey(Date.now())]);

  if (!a) {
    return (
      <Screen>
        <Empty icon="sleep" title="No sleep data yet" body="Connect your watch or log a night so eepy can work out whether you need a nap." />
      </Screen>
    );
  }

  const nap = a.nap;
  const timer = settings.napTimer;
  const today = dateKey(now);
  const upcoming = settings.upcoming?.date === today ? settings.upcoming.kind : undefined;
  const recentKss = dayLog?.sleepinessAt && now - dayLog.sleepinessAt < 3 * 3600_000 ? dayLog.sleepiness : undefined;

  // Alarm + a pinned "Napping · alarm at …" card; both are cleared when the nap is stopped.
  const start = (o: NapOption) => startNapTimer(useStore.getState(), o);
  const stop = (log: boolean) => stopNapTimer(useStore.getState(), log);

  // The recommended nap is the button — unless the advice is to skip it.
  const best = nap.best?.suitable && nap.verdict !== 'skip' ? nap.best : undefined;
  const others = nap.options.filter((o) => o.type !== best?.type);
  const verdict =
    nap.verdict === 'nap-now' ? 'Nap now' : nap.verdict === 'nap-later' ? `Nap at ${formatTime(nap.window?.start ?? nap.best?.start ?? now)}` : nap.verdict === 'optional' ? 'Up to you' : 'Skip it';
  // One line: the strongest reason to nap, or why not to.
  const reason = nap.verdict === 'skip' || nap.verdict === 'optional' ? nap.headline.replace(/^Optional — a/, 'A') : (nap.reasons[0] ?? nap.headline);

  return (
    <Screen>
      {timer ? (
        <>
          <Hero
            label={timer.label}
            value={countdown(timer.alarmAt - now)}
            color={colors.accent}
            caption={
              now < timer.alarmAt
                ? `${timer.backupAt ? `Watch buzzes at ${formatTime(timer.alarmAt)}, phone alarm at ${formatTime(timer.backupAt)}` : `Alarm at ${formatTime(timer.alarmAt)}`}. Lie down somewhere dark and quiet. Even dozing helps.`
                : 'Time to get up. Get some light and move around for a few minutes.'
            }
          >
            <View style={{ marginTop: space.md }}>
              <Meter value={now - timer.start} max={Math.max(1, timer.alarmAt - timer.start)} />
            </View>
          </Hero>
          <View style={{ gap: space.sm, marginBottom: space.md }}>
            <Button big icon="check" label="I'm up" onPress={() => stop(true)} />
            <Button kind="ghost" label="Cancel without logging" onPress={() => stop(false)} />
          </View>
        </>
      ) : (
        <>
          <Hero label="Should you nap?" value={verdict} color={nap.verdict === 'nap-now' ? colors.accent : colors.text} caption={reason} />
          {best ? (
            <View style={{ marginBottom: space.md }}>
              <Button big icon="alarm" label={`Start ${best.alarmAfterMin}-min nap${nap.verdict === 'nap-later' ? ' now' : ''}`} onPress={() => start(best)} />
              <Text style={[font.small, { marginTop: space.sm, paddingHorizontal: space.xs }]}>
                {best.label}, alarm at {formatTime(now + best.alarmAfterMin * MINUTE)}. {tradeOff(best)}.
              </Text>
              <Text style={[font.tiny, { marginTop: space.xs, paddingHorizontal: space.xs }]}>{best.description}</Text>
            </View>
          ) : null}
          <Section title={best ? 'Other naps' : 'If you nap anyway'}>
            <ListCard>
              {others.map((o) => (
                <View key={o.type} style={o.suitable ? null : { opacity: 0.6 }}>
                  <Fold bare icon={OPTION_ICON[o.type]} title={`${o.label} · ${o.alarmAfterMin} min`} sub={o.suitable ? tradeOff(o) : o.why}>
                    <Text style={font.small}>{o.description}</Text>
                    {o.suitable ? (
                      <View style={{ marginTop: space.md, alignItems: 'flex-start' }}>
                        <Button small kind="secondary" icon="alarm" label={`Start ${o.alarmAfterMin}-min nap`} onPress={() => start(o)} />
                      </View>
                    ) : (
                      <Text style={[font.small, { marginTop: space.sm }]}>{tradeOff(o)}.</Text>
                    )}
                  </Fold>
                </View>
              ))}
            </ListCard>
          </Section>
        </>
      )}

      <Section title="About today">
        <ListCard>
          <Fold bare icon="emoticon-neutral-outline" title="How sleepy are you?" sub="Counts for three hours" value={recentKss !== undefined ? `${recentKss} of 9` : undefined}>
            <NumberScale onPanel value={recentKss} onPick={(v) => logDay(today, { sleepiness: v, sleepinessAt: Date.now() })} />
          </Fold>
          <Fold bare icon="calendar-alert-outline" title="Anything demanding later?" sub="A nap beforehand protects you" value={DEMANDS.find((d) => d.kind === upcoming)?.label}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {DEMANDS.map((d) => (
                <Chip key={d.label} label={d.label} icon={d.icon} selected={upcoming === d.kind} onPress={() => setSettings({ upcoming: d.kind ? { kind: d.kind, date: today } : undefined })} />
              ))}
            </View>
          </Fold>
        </ListCard>
        <NapLogCard />
      </Section>

      <Section title="Why">
        <ListCard>
          <Fold bare icon="help-circle-outline" title="What this is based on" value={`Need ${nap.needScore} of 100`}>
            <KeyValue label="Nap need" sub="From sleep debt, last night, your energy and how you feel" value={`${nap.needScore} / 100`} />
            {nap.window ? <KeyValue label="Best time today" sub={`Finish by ${formatTime(nap.latestEnd)}`} value={`${formatTime(nap.window.start)} – ${formatTime(nap.window.end)}`} /> : null}
            <Lines items={nap.reasons} />
          </Fold>
          <Fold bare icon="alert-circle-outline" title="Keep in mind" value={String(nap.cautions.length)}>
            <Lines items={nap.cautions} />
          </Fold>
          <Fold bare icon="flask-outline" title="How eepy decides">
            <Lines
              plain
              items={[
                "Nap need combines your 14-night sleep debt, last night's shortfall against your own sleep need, your predicted energy, how sleepy you say you feel, and anything demanding coming up.",
                'Timing aims at your afternoon dip. Each nap is simulated: the energy gain is the average change over the 3 hours after waking, and the bedtime cost is how much the nap lowers your sleep pressure at bedtime.',
                `Short naps (10–20 min) stay in light sleep, so you wake up sharp. A full cycle of about ${a.cycleMin} minutes finishes deep and REM sleep and wakes you from light sleep. In between you are likely to wake from deep sleep, groggy.`,
              ]}
            />
          </Fold>
        </ListCard>
      </Section>
    </Screen>
  );
}
