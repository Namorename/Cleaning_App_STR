import { Linking } from 'react-native';

import { currentLanguage, type Language } from '@/i18n';
import { reportError } from '@/lib/sentry';

/**
 * The privacy policy the stores ask for (owner, 2026-10-10): the panel's
 * public page, which every visitor can read without signing in.
 */
export const PRIVACY_POLICY_URL = 'https://woom-bnb.vercel.app/privacy';

/** The policy in her language: the page reads it from `?lang=`. */
export function privacyPolicyUrl(language: Language): string {
  return `${PRIVACY_POLICY_URL}?lang=${language}`;
}

/** Opened in the phone's browser, not inside the app. */
export function openPrivacyPolicy(): void {
  Linking.openURL(privacyPolicyUrl(currentLanguage())).catch((error: unknown) => {
    reportError(error);
  });
}
