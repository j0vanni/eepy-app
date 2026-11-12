/**
 * Settings → Wind-down & phone light → Bedtime rundown (engine/rundown.ts): switch it on or off,
 * reading time, and every step — on or off, its minutes (a routine step's length, an evening
 * step's lead before lights-out), earlier / later, its own reminder — plus your own steps and
 * "Reset to the default steps". Tap a step for what it is and why.
 */
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  addCustomRundownStep,
  moveRundownStep,
  nudgeRundownMinutes,
  READING_OPTIONS,
  removeCustomRundownStep,
  resetRundown,
  rundownCatalog,
  RundownCatalogItem,
  rundownFor,
  setRundownMinutes,
  setRundownReminder,
  toggleRundownStep,
} from '../../engine/rundown';
import { formatDuration, formatTime, MINUTE } from '../../engine/time';
import { updateRundown } from '../../state/rundown';
import { NotificationPrefs, useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { AppSwitch, Button, Card, Chip, Fold, Icon, ListCard, ListRow, Row, Section, Stepper, styles as kit } from '../components';
import { confirm } from '../confirm';
import { colors, font, space } from '../theme';
import { field, Para } from './parts';
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

/** One step: tap the name for what it is and its settings; the switch turns it on or off. */
function StepRow({ item, open, onOpen }: { item: RundownCatalogItem; open: boolean; onOpen: () => void }) {
  const prefs = useStore((s) => s.settings.notifications);
  const setNotificationPrefs = useStore((s) => s.setNotificationPrefs);
  const setPref = (key: keyof NotificationPrefs, v: boolean) => setNotificationPrefs({ [key]: v });
  return (
    <View>
      <View style={kit.listRow}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${item.title}: ${subOf(item)}`}
          style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md }, pressed ? { opacity: 0.65 } : null]}
        >
          <View style={kit.listIcon}>
            <Icon name={item.icon} size={22} color={item.on ? colors.textDim : colors.textFaint} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[font.body, !item.on ? { color: colors.textDim } : null]}>{item.title}</Text>
            <Text style={font.small}>{subOf(item)}</Text>
          </View>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} color={colors.textFaint} />
        </Pressable>
        {item.required ? <Text style={font.tiny}>Always</Text> : <AppSwitch value={item.on} onChange={(v) => updateRundown((s) => toggleRundownStep(s, item.id, v))} label={item.title} />}
      </View>
      {open ? (
        <View style={{ paddingBottom: space.md }}>
          <Text style={font.small}>{item.detail}</Text>
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
            <Row gap={space.sm} style={{ marginTop: space.sm, flexWrap: 'wrap' }}>
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
          {item.group === 'routine' && !item.screenFree && item.id !== 'lights-out' ? <Text style={[font.tiny, { marginTop: space.sm }]}>Uses a screen, so it stays before phone-down.</Text> : null}
          {item.canRemind ? (
            <Toggle label="Remind me" sub={item.kind === 'by' ? '15 min before its time' : 'When it starts'} value={item.remind} onChange={(v) => updateRundown((s) => setRundownReminder(s, item.id, v))} />
          ) : null}
          {item.id === 'phone-down' ? (
            <>
              <Toggle label="Heads-up 10 min before" sub="Last messages and the alarm check" value={prefs.phoneDownSoon} onChange={(v) => setPref('phoneDownSoon', v)} />
              <Toggle label="Reminder at phone-down" sub="Charger across the room, and what's next" value={prefs.screensOff} onChange={(v) => setPref('screensOff', v)} />
            </>
          ) : null}
          {item.id === 'lights-out' ? <Toggle label="Lights-out reminder" sub={'"Reading time\'s up — lights out" with reading time'} value={prefs.bedtime} onChange={(v) => setPref('bedtime', v)} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Your own step: a name first; minutes and where it goes appear once you type. */
function AddStep() {
  const [title, setTitle] = useState('');
  const [min, setMin] = useState(5);
  const [screenFree, setScreenFree] = useState(true);
  const name = title.trim();
  const add = () => {
    if (!name) return;
    updateRundown((s) => addCustomRundownStep(s, { title, min, screenFree }, `custom-${Date.now().toString(36)}`));
    setTitle('');
    setMin(5);
    setScreenFree(true);
  };
  return (
    <View style={{ paddingVertical: space.md }}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Add your own step: stretch, pack lunch…"
        placeholderTextColor={colors.textFaint}
        maxLength={40}
        accessibilityLabel="New step"
        style={field}
      />
      {name ? (
        <>
          <Stepper label="Minutes" value={`${min} min`} onDec={() => setMin((m) => nudgeRundownMinutes('custom', m, -1))} onInc={() => setMin((m) => nudgeRundownMinutes('custom', m, 1))} />
          <Toggle label="Screen-free" sub={screenFree ? 'Goes after phone-down, before lights-out' : 'Needs a screen: goes before phone-down'} value={screenFree} onChange={setScreenFree} />
          <Button kind="secondary" icon="plus" label={`Add "${name}"`} onPress={add} />
        </>
      ) : null}
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
    return catalog.routine
      .slice(pd + 1)
      .filter((x) => x.on)
      .reduce((a, x) => a + x.min, 0);
  })();
  const longer = routineMin > windDownMin;
  const fitMin = Math.min(120, Math.ceil(routineMin / 15) * 15);

  return (
    <>
      <Section title="Bedtime rundown">
        <ListCard>
          <Toggle
            label="Bedtime rundown"
            sub={s.enabled ? 'Today, wind-down and the reminders follow your steps' : 'Off: the plain wind-down, screens off a set time before lights-out'}
            value={s.enabled}
            onChange={(enabled) => updateRundown((x) => ({ ...x, enabled }))}
          />
          {s.enabled && tonight ? (
            <ListRow
              icon="clock-outline"
              title={`Tonight: phone down ${formatTime(tonight.phoneDown)}`}
              sub={`Wind-down ${formatTime(tonight.windDownStart)} · ${formatDuration((tonight.lightsOut - tonight.phoneDown) / MINUTE)} screen-free · lights out ${formatTime(tonight.lightsOut)}`}
            />
          ) : null}
          <Fold bare title="What the rundown is">
            <Para first>Your evening step by step, built backwards from lights-out, with what to do and why.</Para>
            <Para>In the evening, "Start my rundown" on Today takes you through it one step at a time. Phone-down is when the screen-free steps start.</Para>
          </Fold>
        </ListCard>

        {s.enabled ? (
          <Card>
            <Text style={[font.label, { marginBottom: space.sm }]}>READING TIME</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {READING_OPTIONS.map((m) => (
                <Chip key={m} label={m === 0 ? 'None' : `${m} min`} selected={s.readingMin === m} onPress={() => updateRundown((x) => setRundownMinutes(x, 'reading', m))} />
              ))}
            </View>
            <Text style={[font.tiny, { marginTop: space.sm }]}>
              {settings.eReader.enabled ? 'On your e-reader, frontlight low and warm. Somewhere comfy, not in bed if you often lie awake.' : 'A paper book under a dim, warm lamp. Somewhere comfy, not in bed if you often lie awake.'}
            </Text>
            <Text style={[font.small, { marginTop: space.md }]}>
              {`${formatDuration(routineMin)} from wind-down to lights-out (${screenFreeMin} min screen-free) · your wind-down is ${formatDuration(windDownMin)}.`}
            </Text>
            {longer ? (
              <View style={{ marginTop: space.sm, gap: space.sm }}>
                <Text style={[font.small, { color: colors.warn }]}>That's longer than your wind-down, so optional steps shorten each night, reading first.</Text>
                {fitMin > windDownMin ? (
                  <View style={{ alignItems: 'flex-start' }}>
                    <Button small kind="secondary" icon="timer-sand" label={`Make wind-down ${formatDuration(fitMin)}`} onPress={() => setProfile({ windDownMin: fitMin })} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        ) : null}
      </Section>

      {s.enabled ? (
        <>
          <Section title="Evening steps">
            <ListCard>
              {catalog.evening.map((item) => (
                <StepRow key={item.id} item={item} open={open === item.id} onOpen={() => toggleOpen(item.id)} />
              ))}
            </ListCard>
          </Section>
          <Section title="Wind-down to lights-out">
            <ListCard>
              {catalog.routine.map((item) => (
                <StepRow key={item.id} item={item} open={open === item.id} onOpen={() => toggleOpen(item.id)} />
              ))}
              <AddStep />
              <ListRow
                icon="restore"
                title="Reset to the default steps"
                onPress={async () => {
                  if (await confirm('Reset your rundown?', 'Back to the default steps, minutes and order. Your own steps are removed.', 'Reset', true)) updateRundown(resetRundown);
                }}
              />
            </ListCard>
          </Section>
        </>
      ) : null}
    </>
  );
}
