'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState, LoadingState } from '@/components/states';
import {
  useChatsOn,
  useSetGuestChats,
  useSignalSettings,
  useUpdateSettings,
} from '@/features/guest-signals/use-guest-signals';
import { serverErrorText } from '@/lib/server-error';

import { Toggle } from './host-toggles';

interface GuestTaskSourcesProps {
  /** Read from app_metadata by the page: the switches are an admin's, as every gate of guests. */
  isAdmin: boolean;
}

/**
 * «Задания от гостей» (the owner's request of 2026-11-19): two switches, one a source.
 *
 * - Reviews: their tasks alone (`tasks_enabled` of the reviews' row) — off, no review is offered as
 *   a task and none is made; ratings and «Качество объектов» go on.
 * - Chats: the whole source (set_guest_chats) — off, no conversation is read at all, for tasks or
 *   for «Качество объектов», and the model costs nothing; what was found stays hidden until on.
 *
 * Each saves itself when pressed and names only itself, as the company's other switches.
 */
export function GuestTaskSources({ isAdmin }: GuestTaskSourcesProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const settings = useSignalSettings();
  const chats = useChatsOn();
  const reviews = useUpdateSettings();
  const chatSwitch = useSetGuestChats();

  if (settings.isPending || chats.isPending) {
    return <LoadingState>{t('panel.settings.workflow.loading')}</LoadingState>;
  }
  if (settings.isError || chats.isError) {
    return (
      <ErrorState message={t('panel.settings.loadError')} error={settings.error ?? chats.error} />
    );
  }

  const isBusy = reviews.isPending || chatSwitch.isPending;
  const failure = reviews.isError
    ? serverErrorText(reviews.error)
    : chatSwitch.isError
      ? serverErrorText(chatSwitch.error)
      : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 border-t pt-4">
      <h3 id={headingId} className="text-sm font-semibold">
        {t('panel.settings.guestTasks.title')}
      </h3>
      {isAdmin ? null : (
        <p className="text-sm text-muted-foreground">{t('panel.guests.settings.adminOnly')}</p>
      )}

      <Toggle
        id="guest-tasks-reviews"
        label={t('panel.settings.guestTasks.reviews')}
        hint={t('panel.settings.guestTasks.reviewsHint')}
        checked={settings.data.tasks_enabled}
        disabled={!isAdmin || isBusy}
        onChange={(next) => reviews.mutate({ tasksEnabled: next })}
      />
      <Toggle
        id="guest-tasks-chats"
        label={t('panel.settings.guestTasks.chats')}
        hint={t('panel.settings.guestTasks.chatsHint')}
        checked={chats.data === true}
        disabled={!isAdmin || isBusy}
        onChange={(next) => chatSwitch.mutate(next)}
      />

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{failure.text}</p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}
    </section>
  );
}
