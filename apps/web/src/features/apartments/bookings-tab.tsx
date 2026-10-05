'use client';

import { STATUS_TONE } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { StatusBadge, statusKey } from '@/components/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDay, todayIso } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { ListingLink } from './listing-link';
import { isUpcoming, type ListingRef } from './schema';
import { useReservations } from './use-apartments';

interface BookingsTabProps {
  propertyId: number;
  /** Set on a room: its bookings stand on its listing (plan 7.1, trap 5). */
  listing?: ListingRef | null;
}

/**
 * What is booked on this flat.
 *
 * Newest arrival first, because the question asked on a card is nearly always
 * "who is in it now and who is next", and the past is there to check a
 * cleaning against rather than to be read through.
 *
 * A block is not a guest. Hostaway calls an owner stay or a closed week a
 * reservation too, and those produce no cleaning — a row with no name and no
 * explanation would read as a booking somebody lost.
 */
export function BookingsTab({ propertyId, listing = null }: BookingsTabProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const reservations = useReservations(propertyId);
  const today = todayIso();

  if (listing !== null) {
    return (
      <p className="text-sm">
        {t('panel.apartments.room.bookings')}{' '}
        <ListingLink className="underline" id={listing.id}>
          {listing.name}
        </ListingLink>
      </p>
    );
  }
  if (reservations.isPending) {
    return <LoadingState>{t('panel.apartments.loading')}</LoadingState>;
  }
  if (reservations.isError) {
    return (
      <ErrorState message={t('panel.apartments.bookings.loadError')} error={reservations.error} />
    );
  }

  const rows = reservations.data ?? [];
  if (rows.length === 0) {
    return <EmptyState>{t('panel.apartments.bookings.empty')}</EmptyState>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('panel.apartments.bookings.guest')}</TableHead>
          <TableHead>{t('panel.apartments.bookings.dates')}</TableHead>
          <TableHead>{t('panel.apartments.bookings.guests')}</TableHead>
          <TableHead>{t('panel.apartments.bookings.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((reservation) => (
          <TableRow key={reservation.id}>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">
                  {reservation.is_block
                    ? t('panel.apartments.bookings.block')
                    : (reservation.guest_name ?? t('panel.apartments.bookings.noName'))}
                </span>
                {isUpcoming(reservation, today) ? (
                  <Badge tone={STATUS_TONE['bookingsTab.upcoming']}>
                    {t('panel.apartments.bookings.upcoming')}
                  </Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-sm">
              {formatDay(reservation.arrival_date, language)} —{' '}
              {formatDay(reservation.departure_date, language)}
            </TableCell>
            <TableCell className="text-sm">{reservation.guests_count ?? '—'}</TableCell>
            <TableCell>
              {/* Hostaway's code, in the calendar card's words where it has them. */}
              <StatusBadge status={statusKey('bookingCard', reservation.status)}>
                {t(`panel.calendar.card.statuses.${reservation.status}`, {
                  defaultValue: reservation.status,
                })}
              </StatusBadge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
