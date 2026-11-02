/** The night view's "Can't sleep?" line: get up after ~20 min — on your e-reader, when you read on one. */
import { Text } from 'react-native';

import { eReaderGetUpTip, eReaderIfOn } from '@/engine/eReader';
import { useStore } from '@/state/store';
import { font } from '@/ui/theme';

export function CantSleepTip() {
  const eReader = eReaderIfOn(useStore((s) => s.settings.eReader));
  return (
    <Text style={font.tiny}>
      {eReader
        ? `Breathing and soft noise. Awake 20+ min? ${eReaderGetUpTip(eReader)}`
        : "Breathing and soft noise. If you've been awake 20+ min, get up in dim light until sleepy."}
    </Text>
  );
}
