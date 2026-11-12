// Old route: Trends now lives in the Sleep tab (Nights · Trends).
import { Redirect } from 'expo-router';

export default function TrendsRedirect() {
  return <Redirect href={{ pathname: '/sleep', params: { view: 'trends' } }} />;
}
