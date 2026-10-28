import { useState } from 'react';
import { Text, View } from 'react-native';

import { planJetLag } from '@/engine/jetlag';
import { formatClock, normalizeMinutes } from '@/engine/time';
import { useStore } from '@/state/store';
import { useAnalysis } from '@/state/useAnalysis';
import { Card, CardTitle, Note, Row, Screen, Section, Segmented, Stepper } from '@/ui/components';
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
        <Segmented
          value={preDays}
          onChange={setPreDays}
          options={[0, 1, 2, 3].map((n) => ({ label: n === 0 ? 'No' : `${n} day${n > 1 ? 's' : ''}`, value: n }))}
        />
        <Text style={[font.tiny, { marginTop: space.sm }]}>
          Using your usual sleep {formatClock(bed)}–{formatClock(wake)} (home time).
        </Text>
      </Card>

      <Note tone="info" icon="airplane">
        {plan.summary}
      </Note>

      {plan.days.length ? (
        <Section title="Day by day">
          {plan.days.map((d) => (
            <Card key={d.dayIndex} accent={d.dayIndex === 0 ? colors.accent : undefined}>
              <CardTitle
                icon={d.dayIndex < 0 ? 'home-clock-outline' : d.dayIndex === 0 ? 'airplane-takeoff' : 'map-marker-radius-outline'}
                title={d.label}
                right={<Text style={font.tiny}>{d.zone === 'home' ? 'HOME TIME' : 'LOCAL TIME'}</Text>}
              />
              <Row>
                <Text style={[font.body, { flex: 1 }]}>
                  Sleep {formatClock(d.bedtimeMin)} → {formatClock(d.wakeMin)}
                </Text>
              </Row>
              {d.seekLight ? (
                <View style={{ marginTop: 6, gap: 2 }}>
                  <Text style={font.small}>
                    ☀️ Seek bright light {formatClock(d.seekLight.startMin)}–{formatClock(d.seekLight.endMin)}
                  </Text>
                  <Text style={font.small}>
                    🕶 Avoid bright light {formatClock(d.avoidLight!.startMin)}–{formatClock(d.avoidLight!.endMin)}
                  </Text>
                </View>
              ) : null}
              {d.notes.map((n) => (
                <Text key={n} style={[font.tiny, { marginTop: 6 }]}>
                  {n}
                </Text>
              ))}
            </Card>
          ))}
        </Section>
      ) : null}
      <Text style={[font.tiny, { marginTop: space.md }]}>
        Light windows are timed around your estimated core-body-temperature minimum: light after it moves your clock earlier, light before it moves it later. If a seek
        window falls while you'd be asleep, just get light as soon as you wake.
      </Text>
    </Screen>
  );
}
