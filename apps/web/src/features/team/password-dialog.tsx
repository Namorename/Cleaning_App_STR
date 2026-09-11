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
import { serverErrorText } from '@/lib/server-error';

import type { StaffAccount } from './schema';
import { useResetPassword } from './use-team';

export interface PasswordSubject {
  account: StaffAccount;
  name: string;
  email: string;
  /**
   * The account was made, but a listing did not open.
   *
   * It belongs on this dialog rather than back in the form: the form is gone
   * by now, and this is the screen the manager is already reading. She can
   * finish the job from the list afterwards — the password is the part that
   * cannot be recovered, so it keeps the top of the dialog.
   */
  linkWarning?: string | null;
}

interface PasswordDialogProps {
  subject: PasswordSubject;
  onClose: () => void;
}

/**
 * The one moment the password is readable.
 *
 * It is stored hashed, so this dialog is the only place it will ever be shown:
 * once it is closed, the only way back to a known password is to make a new
 * one. The dialog says so, and puts that button right here rather than making
 * the manager hunt for it in the list.
 *
 * "Send a new one" is the answer to "the letter never arrived". It cannot
 * re-send the same password — nothing kept it — so it makes another and posts
 * that, which is also what the button says.
 */
export function PasswordDialog({ subject, onClose }: PasswordDialogProps) {
  const { t } = useTranslation();
  const reset = useResetPassword();
  const [shown, setShown] = useState<StaffAccount>(subject.account);
  const [isCopied, setIsCopied] = useState(false);

  const password = shown.password ?? '';
  const failure = reset.isError ? serverErrorText(reset.error) : null;
  const mailFailure = shown.emailSent === true ? null : (shown.mailFailureKey ?? null);

  const copy = () => {
    // A page served over plain http, or a browser that refuses the permission,
    // has no clipboard. The password is on screen either way; only the
    // convenience is lost, so nothing here may throw.
    void navigator.clipboard
      ?.writeText(password)
      .then(() => setIsCopied(true))
      .catch(() => setIsCopied(false));
  };

  const sendAnother = () => {
    setIsCopied(false);
    reset.mutate(shown.id, { onSuccess: setShown });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('panel.team.password.title', { name: subject.name })}</DialogTitle>
          <DialogDescription>{t('panel.team.password.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('panel.team.password.login')}</span>
            <span className="font-mono text-sm">{subject.email}</span>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {t('panel.team.password.password')}
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-base">
                {password}
              </code>
              <Button type="button" variant="outline" onClick={copy}>
                {isCopied ? t('panel.team.password.copied') : t('panel.team.password.copy')}
              </Button>
            </div>
          </div>

          {mailFailure === null ? (
            <p className="text-sm text-muted-foreground">
              {t('panel.team.password.mailSent', { email: subject.email })}
            </p>
          ) : (
            <p role="alert" className="text-sm text-destructive">
              {t('panel.team.password.mailFailed')} {serverErrorText({ hint: mailFailure }).text}
            </p>
          )}

          {subject.linkWarning == null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {t('panel.team.password.linksFailed')} {subject.linkWarning}
            </p>
          )}

          {failure === null ? null : (
            <div role="alert" className="flex flex-col gap-1">
              <p className="text-sm text-destructive">{failure.text}</p>
              {failure.detail === null ? null : (
                <p className="text-xs text-muted-foreground">{failure.detail}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={reset.isPending} onClick={sendAnother}>
              {reset.isPending
                ? t('panel.team.password.sending')
                : t('panel.team.password.sendAnother')}
            </Button>
            <Button type="button" onClick={onClose}>
              {t('panel.team.password.done')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
