/** One-tap shortcuts: long-press app-icon shortcuts and the "Log coffee" Quick Settings tile. */
import { Platform, Text } from 'react-native';

import { canRequestCoffeeTile, hasAppShortcuts, requestCoffeeTile } from '../../shortcuts/appShortcuts';
import { APP_SHORTCUTS } from '../../shortcuts/quickActions';
import { Button, Card, CardTitle, Note, Section } from '../components';
import { notify } from '../confirm';
import { font, space } from '../theme';

export function ShortcutsSection() {
  const android = Platform.OS === 'android';
  const available = hasAppShortcuts();
  const addTile = async () => {
    if (!(await requestCoffeeTile())) {
      notify('Quick Settings', 'Swipe down twice, tap the pencil (Edit) and drag "Log coffee" into your tiles.');
    }
  };
  return (
    <Section title="Shortcuts">
      <Card>
        <CardTitle icon="gesture-tap-hold" title="One tap, no menus" />
        <Text style={font.small}>
          Long-press the eepy icon: {APP_SHORTCUTS.map((s) => s.longLabel).join(' · ')}. Drag one onto your home screen to keep it there.
        </Text>
        <Text style={[font.small, { marginTop: space.sm }]}>
          The "Log coffee" Quick Settings tile logs your usual drink at its usual time from anywhere — with Undo and Change time.
        </Text>
        {!android ? <Note tone="info">Android only — use the eepy APK on your phone.</Note> : null}
        {android && !available ? <Note tone="info">Needs the latest eepy APK.</Note> : null}
        {available ? (
          canRequestCoffeeTile() ? (
            <Button small icon="plus-box-outline" label='Add "Log coffee" to Quick Settings' onPress={() => addTile().catch(() => undefined)} />
          ) : (
            <Text style={[font.tiny, { marginTop: space.sm }]}>Add the tile yourself: swipe down twice, tap the pencil (Edit) and drag "Log coffee" in.</Text>
          )
        ) : null}
      </Card>
    </Section>
  );
}
