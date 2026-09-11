'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SignOutProps {
  /** The server action that drops the session and sends the browser to /login. */
  onSignOut: () => Promise<void>;
}

/**
 * Leaving the panel, on purpose.
 *
 * It used to be one press in the sidebar, right under the navigation — the
 * place a hand goes by accident, and the cost was a manager typing her
 * password again in the middle of a shift. So it lives in Settings now, and
 * asks first.
 *
 * The question is the one the phone already asks, word for word
 * (`auth.signOut*`): the two apps sign the same person out of the same
 * account, and two wordings would only make the panel look like it did
 * something else.
 */
export function SignOut({ onSignOut }: SignOutProps) {
  const { t } = useTranslation();
  const [isAsking, setIsAsking] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setIsAsking(true)}>
        {t('panel.signOut')}
      </Button>

      {isAsking ? (
        <Dialog open onOpenChange={(next) => (next ? undefined : setIsAsking(false))}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('auth.signOutTitle')}</DialogTitle>
              <DialogDescription>{t('auth.signOutQuestion')}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsAsking(false)}>
                {t('panel.cancel')}
              </Button>
              <form action={onSignOut}>
                <Button type="submit">{t('panel.signOut')}</Button>
              </form>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
