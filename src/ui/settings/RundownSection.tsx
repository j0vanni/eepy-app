/**
 * Settings → Wind-down & phone light → Your bedtime rundown (engine/rundown.ts): switch it on or
 * off, reading time, and every step — on or off, its minutes (a routine step's length, an evening
 * step's lead before lights-out), earlier / later, its own reminder — plus your own steps and
 * "Reset to the default steps". Tap a step for what it is and why.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  addCustomRundownStep,
  rundownFor,
  moveRundownStep,
  nudgeRundownMinutes,
  READING_OPTIONS,
  removeCustomRundownStep,
  resetRundown,
  rundownCatalog,
  RundownCatalogItem,
  setRundownMinutes,
  setRundownReminder,
  toggleRundownStep,
} from '../../engine/rundown';
import { formatDuration, formatTime, MINUTE } from '../../engine/time';
import { updateRundown } from '../../state/rundown';
import { NotificationPrefs, useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { AppSwitch, Button, Card, CardTitle, Chip, Divider, Icon, Row, Section, Stepper } from '../components';
import { confirm } from '../confirm';
import { colors, font, radius, space } from '../theme';
import { Toggle } from './Toggle';

const leadLabel = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? formatDuration(min) : `${min} min`);

function subOf(item: RundownCatalogItem): string {
  if (!item.on) return 'Off';
  const at = item.at !== undefined ? formatTime(item.at) : undefined;
  if (item.group === 'evening') {
    const lead = item.range ? `${leadLabel(item.min)} before lights-out` : undefined;
    return [at ? (item.kind === 'by' ? `by ${at}` : at) : undefined, lead].filter(Boolean).join(' · ') || (item.from ?? '');
  }
  if (item.id === 'phone-down') return at ? `${at} · when the screen-free steps start` : 'When the screen-free steps start';
  if (item.id === 'lights-out') return at ? `${at} · tonight's plan` : "Tonight's plan";
  return [`${item.min} min`, at, item.screenFree ? undefined : 'uses a screen'].filter(Boolean).join(' · ');
}

function StepRow({ item, open, onOpen }: { item: RundownCatalogItem; open: boolean; onOpen: () => void }) {
  const prefs = useStore((s) => s.settings.notifications);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);
  const setPref = (key: keyof NotificationPrefs, v: boolean) => setNotificationPrefs({ [key]: v });
  return (
    <View>
      <Row gap={space.sm} style={{ minHeight: 52 }}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${item.title}: ${subOf(item)}`}
          style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm }, pressed ? { opacity: 0.7 } : null]}
        >
          <Icon name={item.icon} size={20} color={item.on ? colors.light : colors.textFaint} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, !item.on ? { color: colors.textDim } : null]}>{item.title}</Text>
            <Text style={font.small}>{subOf(item)}</Text>
          </View>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
        </Pressable>
        {item.required ? (
          <Text style={[font.tiny, { width: 52, textAlign: 'center' }]}>always</Text>
        ) : (
          <AppSwitch value={item.on} onChange={(v) => updateRundown((s) => toggleRundownStep(s, item.id, v))} label={item.title} />
        )}
      </Row>
      {open ? (
        <View style={{ paddingLeft: 32, paddingBottom: space.sm }}>
          <Text style={[font.small, { color: colors.text }]}>{item.detail}</Text>
          {item.range && item.id !== 'reading' ? (
            <Stepper
              label={item.group === 'evening' ? 'Before lights-out' : 'Minutes'}
              value={item.group === 'evening' ? leadLabel(item.min) : `${item.min} min`}
              onDec={() => updateRundown((s) => setRundownMinutes(s, item.id, nudgeRundownMinutes(item.id, item.min, -1)))}
              onInc={() => updateRundown((s) => setRundownMinutes(s, item.id, nudgeRundownMinutes(item.id, item.min, 1)))}
            />
          ) : item.from ? (
            <Text style={[font.tiny, { marginTop: space.xs }]}>{item.from}</Text>
          ) : null}
          {item.group === 'routine' && item.id !== 'lights-out' ? (
            <Row gap={space.sm} style={{ marginTop: space.xs, flexWrap: 'wrap' }}>
              <Button small kind="secondary" icon="arrow-up" label="Earlier" disabled={!item.canUp} onPress={() => updateRundown((s) => moveRundownStep(s, item.id, -1))} />
              <Button small kind="secondary" icon="arrow-down" label="Later" disabled={!item.canDown} onPress={() => updateRundown((s) => moveRundownStep(s, item.id, 1))} />
              {item.custom ? (
                <Button
                  small
                  kind="danger"
                  icon="delete-outline"
                  label="Remove"
                  onPress={async () => {
                    if (await confirm('Remove this step?', `"${item.title}" leaves your rundown.`, 'Remove', true)) updateRundown((s) => removeCustomRundownStep(s, item.id));
                  }}
                />
              ) : null}
            </Row>
          ) : null}
          {item.group === 'routine' && !item.screenFree && item.id !== 'lights-out' ? <Text style={[font.tiny, { marginTop: 4 }]}>Uses a screen, so it stays before phone-down.</Text> : null}
          {item.canRemind ? (
            <Toggle
              label="Remind me"
              sub={item.kind === 'by' ? '15 min before its time' : 'When it starts'}
              value={item.remind}
              onChange={(v) => updateRundown((s) => setRundownReminder(s, item.id, v))}
            />
          ) : null}
          {item.id === 'phone-down' ? (
            <>
              <Toggle label="Heads-up 10 min before" sub="Last messages and the alarm check" value={prefs.phoneDownSoon} onChange={(v) => setPref('phoneDownSoon', v)} />
              <Toggle label="Reminder at phone-down" sub="Charger across the room, and what's next" value={prefs.screensOff} onChange={(v) => setPref('screensOff', v)} />
            </>
          ) : null}
          {item.id === 'lights-out' ? (
            <Toggle label="Lights-out reminder" sub={`"Reading time's up — lights out" with reading time`} value={prefs.bedtime} onChange={(v) => setPref('bedtime', v)} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AddStep() {
  const [title, setTitle] = useState('');
  const [min, setMin] = useState(5);
  const [screenFree, setScreenFree] = useState(true);
  const add = () => {
    if (!title.trim()) return;
    updateRundown((s) => addCustomRundownStep(s, { title, min, screenFree }, `custom-${Date.now().toString(36)}`));
    setTitle('');
    setMin(5);
    setScreenFree(true);
  };
  return (
    <View>
      <Text style={[font.label, { marginBottom: space.sm }]}>ADD YOUR OWN STEP</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Stretch, pack lunch, journal"
        placeholderTextColor={colors.textFaint}
        maxLength={40}
        accessibilityLabel="New step"
        style={{ color: colors.text, backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 12, fontSize: 15 }}
      />
      <Stepper label="Minutes" value={`${min} min`} onDec={() => setMin((m) => nudgeRundownMinutes('custom', m, -1))} onInc={() => setMin((m) => nudgeRundownMinutes('custom', m, 1))} />
      <Toggle label="Screen-free" sub={screenFree ? 'Goes after phone-down, before lights-out' : 'Needs a screen: goes before phone-down'} value={screenFree} onChange={setScreenFree} />
      <Button small icon="plus" label={title.trim() ? `Add "${title.trim()}"` : 'Add step'} disabled={!title.trim()} onPress={add} />
    </View>
  );
}

export function RundownSection() {
  const settings = useStore((x) => x.settings);
  const profile = useStore((x) => x.profile);
  const cbti = useStore((x) => x.cbti);
  const st = { settings, profile, cbti };
  const s = settings.rundown;
  const windDownMin = profile.windDownMin;
  const setProfile = useStore((x) => x.setProfile);
  const analysis = useAnalysis();
  // Tonight as set (not as the guided player has fitted it to a late start).
  const tonight = analysis ? rundownFor(analysis, { ...st, settings: { ...settings, rundownProgress: undefined } }) : undefined;
  const [open, setOpen] = useState<string>();
  const catalog = rundownCatalog(analysis, st);
  const toggleOpen = (id: string) => setOpen((o) => (o === id ? undefined : id));
  const routineMin = catalog.routine.filter((x) => x.on).reduce((a, x) => a + x.min, 0);
  const screenFreeMin = (() => {
    const pd = catalog.routine.findIndex((x) => x.id === 'phone-down');
    return catalog.routine.slice(pd + 1).filter((x) => x.on).reduce((a, x) => a + x.min, 0);
  })();
  const longer = routineMin > windDownMin;
  const fitMin = Math.min(120, Math.ceil(routineMin / 15) * 15);

  return (
    <Section title="Your bedtime rundown">
      <Card>
        <CardTitle icon="format-list-checks" title="Bedtime rundown" color={colors.light} />
        <Text style={font.small}>
          Your evening step by step, built backwards from lights-out — with what to do and why, a guided "Start my rundown" and phone-down when the screen-free steps start.
        </Text>
        <Toggle
          label="Bedtime rundown"
          sub={s.enabled ? 'Today, the wind-down screen and the reminders follow it' : 'Off — the plain wind-down timeline, screens off a set time before lights-out'}
          value={s.enabled}
          onChange={(enabled) => updateRundown((x) => ({ ...x, enabled }))}
        />
        {s.enabled ? (
          <>
            {tonight ? (
              <Row gap={space.sm} style={{ alignItems: 'flex-start', marginTop: space.xs }}>
                <Icon name="clock-outline" size={18} color={colors.textDim} />
                <Text style={[font.small, { flex: 1, color: colors.text }]}>
                  Tonight: wind-down {formatTime(tonight.windDownStart)} · phone down {formatTime(tonight.phoneDown)} ({formatDuration((tonight.lightsOut - tonight.phoneDown) / MINUTE)} screen-free) · lights out{' '}
                  {formatTime(tonight.lightsOut)}
                </Text>
              </Row>
            ) : null}
            <Text style={[font.small, { marginTop: space.sm }]}>
              {formatDuration(routineMin)} from wind-down to lights-out ({screenFreeMin} min screen-free) · your wind-down is {formatDuration(windDownMin)}.
            </Text>
            {longer ? (
              <View style={{ marginTop: space.sm, gap: space.sm }}>
                <Text style={[font.small, { color: colors.warn }]}>That's longer than your wind-down, so optional steps shorten each night — reading first.</Text>
                {fitMin > windDownMin ? (
                  <View style={{ alignItems: 'flex-start' }}>
                    <Button small kind="secondary" icon="timer-sand" label={`Make wind-down ${formatDuration(fitMin)}`} onPress={() => setProfile({ windDownMin: fitMin })} />
                  </View>
                ) : null}
              </View>
            ) : null}
            <Divider />
            <Text style={[font.label, { marginBottom: space.sm }]}>READING TIME</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {READING_OPTIONS.map((m) => (
                <Chip key={m} label={m === 0 ? 'None' : `${m} min`} selected={s.readingMin === m} onPress={() => updateRundown((x) => setRundownMinutes(x, 'reading', m))} />
              ))}
            </View>
            <Text style={[font.tiny, { marginTop: space.sm }]}>
              {st.settings.eReader.enabled
                ? 'On your e-reader, frontlight low and warm — somewhere comfy, not in bed if you often lie awake.'
                : 'A paper book under a dim, warm lamp — somewhere comfy, not in bed if you often lie awake. Read on an e-ink reader? Turn it on below.'}
            </Text>
          </>
        ) : null}
      </Card>
      {s.enabled ? (
        <>
          <Card>
            <CardTitle icon="weather-sunset" title="Evening" sub="Things to have done by a time before lights-out" color={colors.energy} />
            {catalog.evening.map((item) => (
              <StepRow key={item.id} item={item} open={open === item.id} onOpen={() => toggleOpen(item.id)} />
            ))}
          </Card>
          <Card>
            <CardTitle icon="weather-night" title="Wind-down → lights-out" sub="In order; phone down when the screen-free steps start" color={colors.light} />
            {catalog.routine.map((item) => (
              <StepRow key={item.id} item={item} open={open === item.id} onOpen={() => toggleOpen(item.id)} />
            ))}
            <Divider />
            <AddStep />
            <Divider />
            <View style={{ alignItems: 'flex-start' }}>
              <Button
                small
                kind="ghost"
                icon="restore"
                label="Reset to the default steps"
                onPress={async () => {
                  if (await confirm('Reset your rundown?', 'Back to the default steps, minutes and order. Your own steps are removed.', 'Reset', true)) updateRundown(resetRundown);
                }}
              />
            </View>
          </Card>
        </>
      ) : null}
    </Section>
  );
}
