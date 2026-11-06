'use client';

import type { QualityWindow } from '@str-ops/shared';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNumber, NO_VALUE } from '@/features/analytics/format';
import { useLanguage } from '@/lib/use-language';

import { qualityPlaceHref } from './address';
import { ThemeChip, TrustChip } from './chips';
import { formatRating } from './format';
import type { PlaceRowView } from './view-model';

interface PlacesTableProps {
  rows: readonly PlaceRowView[];
  window: QualityWindow;
}

function PlaceRow({ row, window }: { row: PlaceRowView; window: QualityWindow }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { place, stays, themes, trust } = row;

  return (
    <TableRow>
      <TableCell className="max-w-64 whitespace-normal break-words">
        <Link
          href={qualityPlaceHref(place.id, window)}
          className="font-medium underline-offset-4 hover:underline"
        >
          {place.name}
        </Link>
      </TableCell>
      <TableCell>{place.city ?? NO_VALUE}</TableCell>
      <TableCell>
        {place.rating_avg === null || place.rating_n === 0
          ? NO_VALUE
          : t('panel.quality.rating.value', {
              average: formatRating(place.rating_avg, language),
              n: place.rating_n,
            })}
      </TableCell>
      <TableCell className="tabular-nums">{formatNumber(stays, language)}</TableCell>
      <TableCell className="min-w-56 whitespace-normal">
        {themes.length === 0 ? (
          <span className="text-muted-foreground">{t('panel.quality.places.noThemes')}</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {themes.map((line) => (
              <li key={line.theme}>
                <ThemeChip line={line} />
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell>
        <TrustChip level={trust} />
      </TableCell>
    </TableRow>
  );
}

/**
 * The places in their order. On a phone the table scrolls inside its own frame.
 * A city always has a place, so only «только новое» can leave the table empty.
 */
export function PlacesTable({ rows, window }: PlacesTableProps) {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('panel.quality.places.title')}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h2 className="text-base font-semibold">{t('panel.quality.places.title')}</h2>
      {rows.length === 0 ? (
        <EmptyState>{t('panel.quality.places.noNew')}</EmptyState>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('panel.quality.places.name')}</TableHead>
                <TableHead>{t('panel.quality.places.city')}</TableHead>
                <TableHead>{t('panel.quality.places.rating')}</TableHead>
                <TableHead>{t('panel.quality.places.stays')}</TableHead>
                <TableHead>{t('panel.quality.places.themes')}</TableHead>
                <TableHead>{t('panel.quality.places.trust')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <PlaceRow key={row.place.id} row={row} window={window} />
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">{t('panel.quality.places.ratingNote')}</p>
        </>
      )}
    </section>
  );
}
