'use client';

import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from './confirm-dialog';

interface ResetPasswordDialogProps {
  /** Whose password: the name as the row shows it. */
  name: string;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * The question before a password is reset. A reset cannot be undone: the old
 * password stops working the moment the new one is set, on the phone and in
 * the panel, and it used to happen on one press of a row's button.
 *
 * The answer goes to the view, which owns the write and shows the new
 * password after it.
 */
export function ResetPasswordDialog({ name, onConfirm, onClose }: ResetPasswordDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      title={t('panel.team.resetConfirm.title', { name })}
      lines={[t('panel.team.resetConfirm.description')]}
      confirmLabel={t('panel.team.resetConfirm.confirm')}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
