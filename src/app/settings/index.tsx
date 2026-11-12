/** Settings: a search box and the short list of pages, each opening /settings/<id>. */
import { router } from 'expo-router';
import { useState } from 'react';

import { UpdateBanner } from '@/ui/cards/UpdateBanner';
import { ListCard, ListRow, Screen, Section } from '@/ui/components';
import { FeatureSearch } from '@/ui/FeatureSearch';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from '@/ui/settings/sections';

export default function SettingsHome() {
  const [searching, setSearching] = useState(false);
  return (
    <Screen>
      <FeatureSearch onSearchingChange={setSearching} placeholder="Find a setting…" />
      {searching ? null : (
        <>
          <UpdateBanner />
          {SETTINGS_GROUPS.map((g) => (
            <Section key={g} title={g}>
              <ListCard>
                {SETTINGS_SECTIONS.filter((s) => s.group === g).map((s) => (
                  <ListRow key={s.id} icon={s.icon} title={s.title} sub={s.sub} onPress={() => router.push({ pathname: '/settings/[section]', params: { section: s.id } })} />
                ))}
              </ListCard>
            </Section>
          ))}
        </>
      )}
    </Screen>
  );
}
