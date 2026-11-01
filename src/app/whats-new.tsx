// What's new / where things moved (More → What's new, Settings → About). Also shown once as a sheet after the update.
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Screen } from '@/ui/components';
import { space } from '@/ui/theme';
import { markWhatsNewSeen, WhatsNewContent } from '@/ui/WhatsNew';

export default function WhatsNewScreen() {
  return (
    <Screen>
      <Card>
        <WhatsNewContent />
      </Card>
      <View style={{ marginTop: space.sm }}>
        <Button
          label="Got it"
          icon="check"
          onPress={() => {
            markWhatsNewSeen();
            if (router.canGoBack()) router.back();
            else router.replace('/');
          }}
        />
      </View>
    </Screen>
  );
}
