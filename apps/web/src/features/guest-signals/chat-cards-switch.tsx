'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { serverErrorText } from '@/lib/server-error';

import { useChatsOn, useSetGuestChats } from './use-guest-signals';

interface ChatCardsSwitchProps {
  /** The switches of «Гости» are an admin's; the server refuses anybody else (set_guest_chats). */
  isAdmin: boolean;
}

/**
 * «Карточки из чатов» in the settings of «Гости» (owner, 2026-11-26; docs/guest-chats.md §9): the
 * company's chats as a source of cards. It is the one switch of chats (set_guest_chats) — the same
 * as «Задания из чатов» in «Настройки → Компания»: off, no conversation is read, no model is called
 * and no card comes from chats, and the cards from chats leave this screen; on, the reading starts
 * again from shortly before now, as before. Turning it off asks first: what guests write meanwhile
 * is never read.
 */
export function ChatCardsSwitch({ isAdmin }: ChatCardsSwitchProps) {
  const { t } = useTranslation();
  const chats = useChatsOn();
  const setChats = useSetGuestChats();
  const [isAskingOff, setAskingOff] = useState(false);
  const failure = setChats.isError ? serverErrorText(setChats.error) : null;
  // The switch was never read: it stays unpressable, and the line under it says why.
  const readFailure =
    chats.data === undefined && chats.isError ? serverErrorText(chats.error) : null;
  const isOn = chats.data === true;

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-between gap-4">
        <span>{t('panel.guests.settings.chatCards')}</span>
        <Switch
          checked={isOn}
          disabled={!isAdmin || chats.data === undefined || setChats.isPending}
          onCheckedChange={(checked: boolean) =>
            checked ? setChats.mutate(true) : setAskingOff(true)
          }
        />
      </label>
      {readFailure === null ? null : (
        <p role="alert" className="text-destructive">
          {t('panel.settings.loadError')}
          {readFailure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{readFailure.detail}</span>
          )}
        </p>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}

      <Dialog open={isAskingOff} onOpenChange={setAskingOff}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('panel.settings.guestTasks.chatsOffTitle')}</DialogTitle>
            <DialogDescription>{t('panel.settings.guestTasks.chatsOffBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setAskingOff(false)}
            >
              {t('panel.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              onClick={() => {
                setAskingOff(false);
                setChats.mutate(false);
              }}
            >
              {t('panel.settings.guestTasks.chatsOffConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
