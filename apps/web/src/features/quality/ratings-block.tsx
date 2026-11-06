'use client';

import { Constants } from '@str-ops/shared';
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
import { NO_VALUE } from '@/features/analytics/format';
import { useLanguage } from '@/lib/use-language';

import { formatRating } from './format';
import type { QualityCategory, QualityChannel } from './schema';

const KNOWN_CHANNELS: readonly string[] = Constants.public.Enums.signal_channel;

/** A rating and how many stand behind it; nothing to say when none does. */
function RatedCell({ average, n }: { average: number | null; n: number }) {
  const { t } = useTranslation();
  const language = useLanguage();
  return average === null || n === 0
    ? NO_VALUE
    : t('panel.quality.rating.value', { average: formatRating(average, language), n });
}

function ChannelsTable({ channels }: { channels: readonly QualityChannel[] }) {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{t('panel.quality.ratings.channels')}</h3>
      <p className="text-xs text-muted-foreground">{t('panel.quality.ratings.channelsNote')}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('panel.quality.ratings.channel')}</TableHead>
            <TableHead>{t('panel.quality.ratings.rating')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {channels.map(({ channel, n, average }) => (
            <TableRow key={channel}>
              <TableCell>
                {t(`panel.guests.channel.${KNOWN_CHANNELS.includes(channel) ? channel : 'other'}`)}
              </TableCell>
              <TableCell>
                <RatedCell average={average} n={n} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

interface CategoriesTableProps {
  categories: readonly QualityCategory[];
  city: string | null;
}

function CategoriesTable({ categories, city }: CategoriesTableProps) {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{t('panel.quality.ratings.categories')}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('panel.quality.ratings.category')}</TableHead>
            <TableHead>{t('panel.quality.ratings.place')}</TableHead>
            <TableHead>{city ?? t('panel.quality.ratings.city')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category.key}>
              {/* The words stand inside a sentence elsewhere, so they come in lower case. */}
              <TableCell className="first-letter:uppercase">
                {t(`panel.guests.category.${category.key}`)}
              </TableCell>
              <TableCell>
                <RatedCell average={category.average} n={category.n} />
              </TableCell>
              <TableCell>
                <RatedCell average={category.city_average} n={category.city_n} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">{t('panel.quality.ratings.categoriesNote')}</p>
    </section>
  );
}

interface RatingsBlockProps {
  channels: readonly QualityChannel[];
  categories: readonly QualityCategory[];
  city: string | null;
  /** A short window reads three months of ratings: said here. */
  note: string | null;
}

/** «Оценки»: the channels apart, since their scales differ (§7.1), and the city beside each category. */
export function RatingsBlock({ channels, categories, city, note }: RatingsBlockProps) {
  const { t } = useTranslation();
  const hasRatings = channels.length > 0 || categories.length > 0;

  return (
    <section
      aria-label={t('panel.quality.ratings.title')}
      className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h2 className="text-base font-semibold">{t('panel.quality.ratings.title')}</h2>
      {note === null ? null : <p className="text-xs text-muted-foreground">{note}</p>}
      {hasRatings ? null : <EmptyState>{t('panel.quality.ratings.none')}</EmptyState>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {channels.length === 0 ? null : <ChannelsTable channels={channels} />}
        {categories.length === 0 ? null : <CategoriesTable categories={categories} city={city} />}
      </div>
    </section>
  );
}
