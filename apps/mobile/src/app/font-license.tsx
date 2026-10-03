import { FontLicenseScreen } from '@/features/settings/font-license-screen';

/**
 * The font's licence, opened from the settings. Static text that reads no
 * data, so it needs no sign-in guard; its title is set on the root stack.
 */
export default function FontLicenseRoute() {
  return <FontLicenseScreen />;
}
