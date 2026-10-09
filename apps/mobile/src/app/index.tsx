import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { LoadingState } from '@/components/loading-state';
import { useSession } from '@/features/auth/session';

/**
 * Entry point. Reading the stored session from the Keychain is asynchronous,
 * so redirecting before it resolves would bounce a signed-in cleaner to the
 * login screen on every cold start.
 */
export default function Index() {
  const { t } = useTranslation();
  const { userId, isLoading } = useSession();

  if (isLoading) {
    return <LoadingState label={t('auth.signingIn')} />;
  }

  return userId === null ? <Redirect href="/sign-in" /> : <Redirect href="/(tabs)" />;
}
