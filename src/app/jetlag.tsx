/**
 * Jet lag: say where you are flying and how early you can start, and get how long adjusting takes
 * and a day-by-day plan — when to sleep, when to get bright light and when to avoid it.
 */
import { useState } from 'react';
import { Text, View } from 'react-native';

import { planJetLag } from '@/engine/jetlag';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, Fold, Hero, Icon, styles as kit, Row, Screen, Section, Segmented, Stepper } from '@/ui/components';
import { Bullet, Caption } from '@/ui/planner/parts';
import { colors, font, space } from '@/ui/theme';

const fmtOffset = (m: number) => {
  const sign = m >= 0 ? '+' : '−';
  const a = Math.abs(m);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
};

export default function JetLagScreen() {
  const a = useAnalysis();
  const profile = useStore((s) => s.profile);
  const localOffset = -new Date().getTimezoneOffset();
  const [home, setHome] = useState(localOffset);
  const [dest, setDest] = useState(localOffset + 6 * 60);
  const [preDays, setPreDays] = useState(2);
  const bed = Math.round((a?.chronotype.habitual?.onsetMin ?? normalizeMinutes(profile.workWakeMin - 8 * 60 - 30)) / 15) * 15;
  const wake = Math.round((a?.chronotype.habitual?.wakeMin ?? profile.workWakeMin) / 15) * 15;
  const plan = planJetLag({ homeOffsetMin: home, destOffsetMin: dest, bedtimeMin: bed, wakeMin: wake, preDays });

  const clampOffset = (m: number) => Math.max(-12 * 60, Math.min(14 * 60, m));

  return (
    <Screen>
      <Card>
        <Stepper label="Home time zone" value={fmtOffset(home)} onDec={() => setHome(clampOffset(home - 30))} onInc={() => setHome(clampOffset(home + 30))} />
        <Stepper label="Destination" value={fmtOffset(dest)} onDec={() => setDest(clampOffset(dest - 30))} onInc={() => setDest(clampOffset(dest + 30))} />
        <Text style={[font.body, { marginTop: space.sm, marginBottom: space.sm }]}>Start adjusting before you leave</Text>
        <Segmented value={preDays} onChange={setPreDays} options={[0, 1, 2, 3].map((n) => ({ label: n === 0 ? 'No' : `${n} day${n > 1 ? 's' : ''}`, value: n }))} />
        <Text style={[font.tiny, { marginTop: space.md }]}>
          From your usual sleep, {formatClock(bed)}–{formatClock(wake)} home time.
        </Text>
      </Card>

      <View style={{ marginTop: space.md }}>
        {plan.direction === 'none' ? (
          <Hero label="Time difference" value="No plan needed" caption={plan.summary} />
        ) : (
          <Hero
            label={`${Math.abs(plan.shiftHours)} h ${plan.direction} · adjusting takes about`}
            value={`${plan.daysToAdjust} day${plan.daysToAdjust === 1 ? '' : 's'}`}
            caption={plan.summary}
          />
        )}
      </View>

      {plan.days.length ? (
        <Section title="Day by day">
          <Card style={{ paddingVertical: space.xs }}>
            {plan.days.map((d, i) => (
              <View key={d.dayIndex}>
                {i ? <View style={kit.listSep} /> : null}
                <Row gap={space.md} style={{ alignItems: 'flex-start', paddingVertical: space.md }}>
                  <View style={kit.listIcon}>
                    <Icon name={d.dayIndex < 0 ? 'home-clock-outline' : d.dayIndex === 0 ? 'airplane-takeoff' : 'map-marker-radius-outline'} size={22} color={d.dayIndex === 0 ? colors.accent : colors.textDim} />
                  </View>
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Row gap={space.sm}>
                      <Text style={[font.body, { flex: 1 }]}>{d.label}</Text>
                      <Caption>{d.zone === 'home' ? 'Home time' : 'Local time'}</Caption>
                    </Row>
                    <Text style={[font.small, { fontVariant: ['tabular-nums'] }]}>
                      Sleep {formatClock(d.bedtimeMin)} → {formatClock(d.wakeMin)}
                    </Text>
                    {d.seekLight ? (
                      <Bullet icon="white-balance-sunny" color={colors.energy}>
                        Bright light {formatClock(d.seekLight.startMin)}–{formatClock(d.seekLight.endMin)}
                      </Bullet>
                    ) : null}
                    {d.avoidLight ? (
                      <Bullet icon="sunglasses">
                        Avoid bright light {formatClock(d.avoidLight.startMin)}–{formatClock(d.avoidLight.endMin)}
                      </Bullet>
                    ) : null}
                    {d.notes.map((n) => (
                      <Text key={n} style={font.tiny}>
                        {n}
                      </Text>
                    ))}
                  </View>
                </Row>
              </View>
            ))}
          </Card>
          <Fold icon="help-circle-outline" title="How the light timing works">
            <Text style={font.small}>
              The light windows are timed around the point in the night when your body is coolest. Light after it moves your clock earlier, light before it moves it later. If a window falls
              while you'd be asleep, get light as soon as you wake.
            </Text>
          </Fold>
        </Section>
      ) : null}
    </Screen>
  );
}
