/** One-tap shortcuts: long-press app-icon shortcuts and the "Log coffee" Quick Settings tile. */
import { Platform } from 'react-native';

import { canRequestCoffeeTile, hasAppShortcuts, requestCoffeeTile } from '../../shortcuts/appShortcuts';
import { APP_SHORTCUTS } from '../../shortcuts/quickActions';
import { ListCard, ListRow, Note, Section } from '../components';
import { notify } from '../confirm';

const TILE_HOW = 'Swipe down twice, tap the pencil (Edit) and drag "Log coffee" into your tiles.';

export function ShortcutsSection() {
  const android = Platform.OS === 'android';
  const available = hasAppShortcuts();
  const addTile = async () => {
    if (!(await requestCoffeeTile())) notify('Quick Settings', TILE_HOW);
  };
  return (
    <Section title="Shortcuts">
      <ListCard>
        <ListRow icon="gesture-tap-hold" title="Long-press the eepy icon" sub={`${APP_SHORTCUTS.map((s) => s.longLabel).join(' · ')}. Drag one to your home screen to keep it there.`} />
        {available && canRequestCoffeeTile() ? (
          <ListRow
            icon="plus-box-outline"
            title={'Add "Log coffee" to Quick Settings'}
            sub="Logs your usual drink from anywhere, with Undo and Change time"
            onPress={() => addTile().catch(() => undefined)}
          />
        ) : (
          <ListRow icon="coffee-outline" title={'"Log coffee" Quick Settings tile'} sub={available ? `Logs your usual drink from anywhere. ${TILE_HOW}` : 'Logs your usual drink from anywhere, with Undo and Change time'} />
        )}
      </ListCard>
      {!android ? <Note tone="info">Shortcuts are Android only. Use the eepy APK on your phone.</Note> : null}
      {android && !available ? <Note tone="info">Shortcuts need the latest eepy APK.</Note> : null}
    </Section>
  );
}
