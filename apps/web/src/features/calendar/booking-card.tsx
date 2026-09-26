'use client';

import { useTranslation } from 'react-i18next';

import type { Language } from '@str-ops/shared';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Property } from '@/features/tasks/schema';
import { formatDay } from '@/lib/format-date';

import { barKind } from './bars';
import { daysBetween } from './dates';
import type { CalendarBooking } from './schema';

interface BookingCardProps {
  /** The booking to show; null keeps the card closed. */
  booking: CalendarBooking | null;
  byId: ReadonlyMap<number, Property>;
  language: Language;
  onClose: () => void;
}

/** `15:00:00` as `15:00`; a missing time is left out. */
function clock(time: string | null): string | null {
  return time === null ? null : time.slice(0, 5);
}

/**
 * A booking, read only (docs/f10-plan.md, 7.3): the listing and its rooms,
 * the guest, how many, the days and the hours. The name of a "#" booking is
 * shown here — on the bar it is a block.
 */
export function BookingCard({ booking, byId, language, onClose }: BookingCardProps) {
  return (
    <Dialog
      open={booking !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      {booking === null ? null : (
        <BookingDetails booking={booking} byId={byId} language={language} />
      )}
    </Dialog>
  );
}

interface BookingDetailsProps {
  booking: CalendarBooking;
  byId: ReadonlyMap<number, Property>;
  language: Language;
}

function BookingDetails({ booking, byId, language }: BookingDetailsProps) {
  const { t } = useTranslation();
  const isBlock = barKind(booking) === 'block';
  const who = isBlock
    ? [t('panel.apartments.bookings.block'), booking.guest_name].filter(Boolean).join(' · ')
    : (booking.guest_name ?? t('panel.apartments.bookings.noName'));
  const rooms = booking.rooms.map(
    (room) => byId.get(room.property_id)?.name ?? String(room.property_id),
  );
  const at = (day: string, time: string | null) =>
    [formatDay(day, language), clock(time)].filter(Boolean).join(', ');

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t('panel.calendar.card.title')}</DialogTitle>
        <DialogDescription>
          {t('panel.calendar.card.nights', {
            count: daysBetween(booking.arrival_date, booking.departure_date),
          })}
        </DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('panel.apartments.bookings.guest')}</dt>
        <dd>{who}</dd>
        <dt className="text-muted-foreground">{t('panel.calendar.property')}</dt>
        <dd>{byId.get(booking.property_id)?.name ?? booking.property_id}</dd>
        {rooms.length === 0 ? null : (
          <>
            <dt className="text-muted-foreground">{t('panel.calendar.card.rooms')}</dt>
            <dd>{rooms.join(', ')}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('panel.apartments.bookings.guests')}</dt>
        <dd>{booking.guests_count ?? '—'}</dd>
        <dt className="text-muted-foreground">{t('panel.calendar.card.arrival')}</dt>
        <dd>{at(booking.arrival_date, booking.check_in_time)}</dd>
        <dt className="text-muted-foreground">{t('panel.calendar.card.departure')}</dt>
        <dd>{at(booking.departure_date, booking.check_out_time)}</dd>
        <dt className="text-muted-foreground">{t('panel.apartments.bookings.status')}</dt>
        <dd>{booking.status}</dd>
      </dl>
    </DialogContent>
  );
}
