/**
 * Settings → Wind-down & phone light → E-ink reader: "I read on an e-ink reader" (Kindle, Kobo,
 * Boox…) and whether it has a warm light. When on, the wind-down timeline gets reading time from
 * screens-off to lights-out, the Phone light tool an e-reader frontlight target, and the
 * screens-off reminder and "can't sleep? get up and read" advice mention it (engine/eReader.ts).
 */
import { formatTime } from '../../engine/time';
import { usePhoneDown } from '../../state/rundown';
import { EReaderSettings, useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { Fold, ListCard, ListRow, Section } from '../components';
import { Para } from './parts';
import { Toggle } from './Toggle';

export function EReaderSection() {
  const eReader = useStore((s) => s.settings.eReader);
  const rundown = useStore((s) => s.settings.rundown);
  const setSettings = useStore((s) => s.setSettings);
  const analysis = useAnalysis();
  const set = (patch: Partial<EReaderSettings>) => setSettings({ eReader: { ...eReader, ...patch } });
  const tonight = analysis?.tonight;
  const off = usePhoneDown(analysis);
  // With the bedtime rundown, reading time is its own step (and can be none).
  const reading = !rundown.enabled || rundown.readingMin > 0;

  return (
    <Section title="E-ink reader">
      <ListCard>
        <Toggle
          label="I read on an e-ink reader"
          sub={eReader.enabled ? 'Your wind-down has reading time until lights-out' : 'Kindle, Kobo, Boox… Off: screens-off means every screen'}
          value={eReader.enabled}
          onChange={(enabled) => set({ enabled })}
        />
        {eReader.enabled ? (
          <Toggle
            label="It has a warm light"
            sub={eReader.warmLight ? 'Warmth up in the evening, all the way at bedtime' : 'Keep it low. A bedside lamp on the page beats the frontlight.'}
            value={eReader.warmLight}
            onChange={(warmLight) => set({ warmLight })}
          />
        ) : null}
        {eReader.enabled && tonight && off !== undefined && off < tonight.bedtime ? (
          <ListRow
            icon="clock-outline"
            title={`Tonight: phone away at ${formatTime(off)}`}
            sub={reading ? `Then read until lights-out at ${formatTime(tonight.bedtime)}` : 'Reading time is off in your bedtime rundown'}
          />
        ) : null}
        <Fold bare title="Why an e-reader is fine">
          <Para first>E-ink reflects light like paper instead of shining it at you. With the frontlight low (and warm) it is fine after screens-off, unlike a phone or tablet.</Para>
          <Para>Keep it to reading: on Android readers like Boox, leave the browser and other apps closed, and turn notifications off at night.</Para>
          <Para>Woken up and can't get back to sleep? Read in a chair in another room with the frontlight at its lowest until you're sleepy.</Para>
        </Fold>
      </ListCard>
    </Section>
  );
}
