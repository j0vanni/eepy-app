/**
 * Settings home: a search box and a short list of pages (You & schedule, Alarms & watch, …), each
 * opening /settings/<id>. Workdays and wake-up times live in Planner → Your usual week.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { UpdateBanner } from '@/ui/cards/UpdateBanner';
import { ListCard, ListRow, Screen, Section } from '@/ui/components';
import { FeatureSearch } from '@/ui/FeatureSearch';
import { SETTINGS_SECTIONS, SettingsSectionInfo } from '@/ui/settings/sections';
import { font, space } from '@/ui/theme';

const GROUPS: SettingsSectionInfo['group'][] = ['You', 'Your nights', 'App & data'];

export default function SettingsHome() {
  const [searching, setSearching] = useState(false);
  return (
    <Screen>
      <FeatureSearch onSearchingChange={setSearching} />
      {searching ? null : (
        <>
          <UpdateBanner />
          {GROUPS.map((g) => (
            <Section key={g} title={g}>
              <ListCard>
                {SETTINGS_SECTIONS.filter((s) => s.group === g).map((s) => (
                  <ListRow key={s.id} icon={s.icon} title={s.title} sub={s.sub} onPress={() => router.push({ pathname: '/settings/[section]', params: { section: s.id } })} />
                ))}
              </ListCard>
            </Section>
          ))}
          <Text style={[font.tiny, { marginTop: space.sm, textAlign: 'center' }]}>Workdays and wake-up times are in Planner → Your usual week.</Text>
        </>
      )}
    </Screen>
  );
}
