import { translations } from '@str-ops/shared';
import type { Metadata } from 'next';

import { privacyLanguage } from './language';
import { readOperator } from './operator';
import { PrivacyPolicy } from './privacy-policy';
import { PRIVACY_SETTINGS } from './settings';

interface PrivacyPageProps {
  searchParams: Promise<{ lang?: string | string[] }>;
}

/** The browser tab: the policy's name with «woom», in the page's language. */
export async function generateMetadata({ searchParams }: PrivacyPageProps): Promise<Metadata> {
  const language = privacyLanguage((await searchParams).lang);
  return { title: translations[language].privacy.metaTitle };
}

/**
 * The privacy policy, public: no sign-in (`proxy.ts` lets `/privacy` through
 * for everyone) and no Supabase call. Decision 17, docs/f11-plan.md. The
 * operator's details are read here, on the server, at request time.
 */
export default async function PrivacyPage({ searchParams }: PrivacyPageProps) {
  const language = privacyLanguage((await searchParams).lang);

  return (
    <PrivacyPolicy language={language} operator={readOperator()} settings={PRIVACY_SETTINGS} />
  );
}
