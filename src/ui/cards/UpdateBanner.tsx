// "Build N is ready — Install": one line at the top of Today and Settings while a newer GitHub build is waiting.
import { router } from 'expo-router';

import { usePendingUpdate } from '../../updates/useUpdates';
import { Banner } from '../components';

export function UpdateBanner() {
  const build = usePendingUpdate();
  if (build === undefined) return null;
  return <Banner icon="cellphone-arrow-down" text={`eepy build ${build} is ready`} action="Install" onAction={() => router.push('/updates')} />;
}
