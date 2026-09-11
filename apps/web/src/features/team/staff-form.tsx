'use client';

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { serverErrorText } from '@/lib/server-error';

import {
  draftFrom,
  LANGUAGES,
  STAFF_ROLES,
  type Staff,
  type StaffAccount,
  type StaffDraft,
} from './schema';
import { useSaveStaff } from './use-team';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

interface StaffFormProps {
  /** The person being changed, or null for somebody new. */
  staff: Staff | null;
  /**
   * A new account came back, with a password to show.
   *
   * Who it belongs to comes from the draft rather than the refreshed list: the
   * dialog opens the instant the account is made, before the list has been
   * re-read, and a heading that said "password for" and then nothing would be
   * the one thing on screen that could not be checked.
   */
  onCreated: (account: StaffAccount, person: { name: string; email: string }) => void;
  onClose: () => void;
}

/**
 * Write a person, or change one.
 *
 * One dialog for both, as everywhere else in the panel: the fields are the
 * same, and a separate wizard would only ask the same questions in more steps.
 *
 * Two fields behave differently once the account exists. The address is shown
 * but not editable — moving a login is an auth operation that wants
 * confirmation on both addresses, and a box that silently did nothing would be
 * worse than no box. And "works here" appears only on an edit: there is no
 * such thing as hiring somebody switched off.
 *
 * Every role is on offer, admin included. A manager who picks it is refused by
 * the server in her own language — one clear refusal beats a list whose
 * contents depend on who is reading it.
 *
 * Mounted only while open, so each opening starts from a fresh draft without
 * an effect to reset one.
 */
export function StaffForm({ staff, onCreated, onClose }: StaffFormProps) {
  const { t } = useTranslation();
  const save = useSaveStaff();
  const [draft, setDraft] = useState<StaffDraft>(() => draftFrom(staff));

  const isNew = staff === null;
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isReady =
    draft.fullName.trim() !== '' && (!isNew || draft.email.trim() !== '') && !save.isPending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(draft, {
      onSuccess: (account) => {
        // An edit answers without a password; only a new account has one to show.
        if (account.password === undefined) {
          onClose();
          return;
        }
        onCreated(account, { name: draft.fullName.trim(), email: draft.email.trim() });
      },
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew ? t('panel.team.form.titleNew') : t('panel.team.form.titleEdit')}
          </DialogTitle>
          <DialogDescription>
            {isNew ? t('panel.team.form.descriptionNew') : t('panel.team.form.descriptionEdit')}
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="staff-name">{t('panel.team.form.name')}</Label>
            <Input
              id="staff-name"
              value={draft.fullName}
              maxLength={80}
              onChange={(event) => setDraft({ ...draft, fullName: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="staff-email">{t('panel.team.form.email')}</Label>
            <Input
              id="staff-email"
              type="email"
              value={draft.email}
              disabled={!isNew}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {isNew ? t('panel.team.form.emailHint') : t('panel.team.form.emailLocked')}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="staff-phone">{t('panel.team.form.phone')}</Label>
              <Input
                id="staff-phone"
                value={draft.phone}
                maxLength={32}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="staff-role">{t('panel.team.form.role')}</Label>
              <select
                id="staff-role"
                className={SELECT_CLASS}
                value={draft.role}
                onChange={(event) =>
                  setDraft({ ...draft, role: event.target.value as StaffDraft['role'] })
                }
              >
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`panel.roles.${role}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="staff-language">{t('panel.team.form.language')}</Label>
            <select
              id="staff-language"
              className={SELECT_CLASS}
              value={draft.language}
              onChange={(event) =>
                setDraft({ ...draft, language: event.target.value as StaffDraft['language'] })
              }
            >
              <option value="">{t('panel.team.form.languageUnset')}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(`panel.team.languages.${language}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t('panel.team.form.languageHint')}</p>
          </div>

          {isNew ? null : (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={draft.isActive}
                onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
              />
              {t('panel.team.form.active')}
            </label>
          )}

          {failure === null ? null : (
            <div role="alert" className="flex flex-col gap-1">
              <p className="text-sm text-destructive">{failure.text}</p>
              {failure.detail === null ? null : (
                <p className="text-xs text-muted-foreground">{failure.detail}</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('panel.team.form.close')}
            </Button>
            <Button type="submit" disabled={!isReady}>
              {save.isPending
                ? t('panel.team.form.saving')
                : isNew
                  ? t('panel.team.form.create')
                  : t('panel.team.form.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
