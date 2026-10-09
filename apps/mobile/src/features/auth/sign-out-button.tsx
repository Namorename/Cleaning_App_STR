import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { Button } from '@/components/button';
import { alertMessage, serverErrorText } from '@/lib/server-error';

import { signOut } from './session';

/**
 * Leaves the account. Asks first: on a shared phone the tap is easy to make
 * by mistake, and signing back in means typing a password in a stairwell.
 * Drawn as the destructive button, in the tone of the question that follows.
 *
 * A failure is said in her language; auth's own English, when there is any,
 * follows as a paragraph of its own for her to pass on.
 */
export function SignOutButton() {
  const { t } = useTranslation();

  const onPress = useCallback(() => {
    Alert.alert(t('auth.signOutTitle'), t('auth.signOutQuestion'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.signOut'),
        style: 'destructive',
        onPress: () => {
          signOut().catch((caught: unknown) => {
            Alert.alert(t('auth.signOutFailed'), alertMessage(serverErrorText(caught)));
          });
        },
      },
    ]);
  }, [t]);

  return <Button variant="destructive" label={t('auth.signOut')} onPress={onPress} />;
}
