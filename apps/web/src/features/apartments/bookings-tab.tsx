'use client';

import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { todayIso } from '@/lib/format-date';

import { isUpcoming } from './schema';
import { useReservations } from './use-apartments';

interface BookingsTabProps {
  propertyId: number;
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
export function BookingsTab({ propertyId }: BookingsTabProps) {
  const { t } = useTranslation();
  const reservations = useReservations(propertyId);
  const today = todayIso();

  if (reservations.isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>;
  }
  if (reservations.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('panel.apartments.bookings.loadError')}
      </p>
    );
  }

  const rows = reservations.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('panel.apartments.bookings.empty')}</p>;
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
                  <Badge variant="outline">{t('panel.apartments.bookings.upcoming')}</Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-sm">
              {reservation.arrival_date} — {reservation.departure_date}
            </TableCell>
            <TableCell className="text-sm">{reservation.guests_count ?? '—'}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{reservation.status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
