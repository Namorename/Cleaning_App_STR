'use client';

import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useReservationGuest } from './use-tasks';

interface TaskDepartureProps {
  /** The Hostaway id of the booking the cleaning closes. */
  reservationId: number;
}

type GuestQuery = ReturnType<typeof useReservationGuest>;

/** The guest's name, or a word for why there is none to show. */
function guestLabel(guest: GuestQuery, t: TFunction): string {
  if (guest.isPending) {
    return t('panel.tasks.form.guestLoading');
  }
  if (guest.isError) {
    return t('panel.tasks.form.guestUnavailable');
  }
  return guest.data?.guest_name ?? t('panel.tasks.form.guestUnknown');
}

/**
 * Whose stay a generated cleaning closes, and the booking's Hostaway id to look
 * it up there. The panel only: the cleaner's phone never shows a guest. The id
 * is the task's own, so it stays on screen even when the name cannot be read.
 */
export function TaskDeparture({ reservationId }: TaskDepartureProps) {
  const { t } = useTranslation();
  const guest = useReservationGuest(reservationId);

  return (
    <dl className="grid gap-3 rounded-md border px-3 py-2 text-sm sm:grid-cols-2">
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">{t('panel.tasks.form.guest')}</dt>
        <dd>{guestLabel(guest, t)}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">{t('panel.tasks.form.reservation')}</dt>
        <dd className="tabular-nums">{reservationId}</dd>
      </div>
    </dl>
  );
}
