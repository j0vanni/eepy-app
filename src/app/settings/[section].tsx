/** One Settings page (/settings/you, /settings/alarms, …); the list of pages is in src/ui/settings/sections.ts. */
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { Button, Empty, Screen } from '@/ui/components';
import { SettingsPage } from '@/ui/settings/pages';
import { isSettingsSection, SETTINGS_SECTION_BY_ID } from '@/ui/settings/sections';

export default function SettingsSectionScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  if (!isSettingsSection(section)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Settings' }} />
        <Empty icon="cog-outline" title="This page has moved" body="Settings are now grouped into a few short pages.">
          <Button label="All settings" icon="cog-outline" onPress={() => router.replace('/settings')} />
        </Empty>
      </Screen>
    );
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: SETTINGS_SECTION_BY_ID[section].title }} />
      <SettingsPage id={section} />
    </Screen>
  );
}
