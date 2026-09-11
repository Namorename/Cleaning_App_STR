'use client';

import { useQuery } from '@tanstack/react-query';
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
import { useSupabase } from '@/lib/supabase/use-client';

import { countOpenCleanings } from './api';
import { apartmentKeys } from './keys';
import type { PropertyStatus } from './schema';
import { useSetStatus } from './use-apartments';

export interface StatusSubject {
  /** The listings about to change, already narrowed to those not in that state. */
  ids: number[];
  status: PropertyStatus;
  /** Their names, for a sentence a manager can check before she agrees to it. */
  names: string[];
  /** Cleanings at stake as the list last saw them; refreshed below for a single listing. */
  openCleanings: number;
}

interface StatusDialogProps {
  subject: StatusSubject;
  onClose: () => void;
}

/**
 * The question asked before a listing stops taking guests.
 *
 * Archiving is how a listing is removed here — there is no delete, because a
 * flat that has been cleaned two hundred times is not a row anybody should be
 * able to drop. What archiving does cost is the cleanings still standing on
 * its books, so that number is named out loud before anything happens.
 *
 * For one listing the number is read again as the dialog opens: this is about
 * to cancel work, and a figure from a page loaded twenty minutes ago is not
 * good enough to cancel work by. For a bulk action the list's own total is
 * used — a fresh read per listing would be a request each, and the server
 * refuses anything it disagrees with regardless.
 */
export function StatusDialog({ subject, onClose }: StatusDialogProps) {
  const { t } = useTranslation();
  const client = useSupabase();
  const setStatus = useSetStatus();
  const [failure, setFailure] = useState<string | null>(null);

  const isSingle = subject.ids.length === 1;
  const fresh = useQuery({
    queryKey: [...apartmentKeys.openCleanings(), subject.ids[0]],
    queryFn: () => countOpenCleanings(client, subject.ids[0]),
    enabled: isSingle,
  });

  const leaving = subject.status !== 'active';
  const atStake = isSingle ? (fresh.data ?? subject.openCleanings) : subject.openCleanings;
  const isBusy = setStatus.isPending || (isSingle && fresh.isPending);

  const confirm = () => {
    setFailure(null);
    void (async () => {
      try {
        for (const propertyId of subject.ids) {
          await setStatus.mutateAsync({
            propertyId,
            status: subject.status,
            cancelTasks: true,
          });
        }
        onClose();
      } catch (error: unknown) {
        // One listing of a batch can be refused on its own — the ones before it
        // are already through, and the list behind the dialog shows which.
        setFailure(serverErrorText(error).text);
      }
    })();
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(`panel.apartments.confirm.title.${subject.status}`)}</DialogTitle>
          <DialogDescription>
            {t('panel.apartments.confirm.listings', {
              total: subject.ids.length,
              names: subject.names.slice(0, 3).join(', '),
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {leaving && atStake > 0 ? (
            <p className="text-sm text-destructive">
              {t('panel.apartments.confirm.cancels', { total: atStake })}
            </p>
          ) : null}

          {leaving ? (
            <p className="text-sm text-muted-foreground">{t('panel.apartments.confirm.keeps')}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t('panel.apartments.confirm.restores')}</p>
          )}

          {failure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('panel.cancel')}
            </Button>
            <Button type="button" disabled={isBusy} onClick={confirm}>
              {isBusy
                ? t('panel.apartments.confirm.working')
                : t(`panel.apartments.confirm.submit.${subject.status}`)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
