// Old route: Trends now lives in the Sleep tab (Trends · Calendar · Nights).
import { Redirect } from 'expo-router';

export default function TrendsRedirect() {
  return <Redirect href="/sleep" />;
}
