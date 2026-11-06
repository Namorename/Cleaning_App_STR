'use client';

import { useTranslation } from 'react-i18next';

import { PageBackLink, PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { formatNumber, NO_VALUE } from '@/features/analytics/format';
import { formatDay, formatShortDay } from '@/lib/format-date';
import { useAddressState } from '@/lib/use-address-state';
import { useLanguage } from '@/lib/use-language';

import { qualityHref, readQualityWindow, writeQualityWindow } from './address';
import { ReadingBand, ShortWindowBand, StaysBand } from './bands';
import { TrustChip } from './chips';
import { formatRating } from './format';
import { MonthChart } from './month-chart';
import { RatingsBlock } from './ratings-block';
import type { QualityPlaceCard } from './schema';
import { PlaceThemeItem } from './theme-line';
import { staysFromOf, type PlaceThemeLine } from './theme-model';
import { useQualityPlace } from './use-quality';
import { placeCardOf, type PlaceCardView } from './view-model';
import { WindowBar, WindowCaption } from './window-bar';

interface FactProps {
  label: string;
  value: string;
}

function Fact({ label, value }: FactProps) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

interface PlaceFactsProps {
  card: QualityPlaceCard;
  view: PlaceCardView;
}

/** The numbers everything under them is read against. */
function PlaceFacts({ card, view }: PlaceFactsProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { rating_avg: average, rating_n: rated } = card.place;

  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
      <Fact label={t('panel.quality.card.stays')} value={formatNumber(view.stays, language)} />
      <Fact label={t('panel.quality.card.rated')} value={formatNumber(rated, language)} />
      <Fact
        label={t('panel.quality.card.rating')}
        value={average === null ? NO_VALUE : formatRating(average, language)}
      />
      <div className="flex items-baseline gap-1">
        <dt className="text-muted-foreground">{t('panel.quality.card.trust')}:</dt>
        <dd>
          <TrustChip level={view.trust} />
        </dd>
      </div>
    </dl>
  );
}

interface ThemesBlockProps {
  title: string;
  lines: readonly PlaceThemeLine[];
  /** Said in place of the list when there is nothing in it. */
  emptyText?: string;
}

function ThemesBlock({ title, lines, emptyText }: ThemesBlockProps) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <h2 className="text-base font-semibold">{title}</h2>
      {lines.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {lines.map((line) => (
            <PlaceThemeItem key={line.theme} line={line} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface EmptyThemesProps {
  view: PlaceCardView;
}

/** «0 тем» on 3 stays and on 300 are different things (§6.4). */
function EmptyThemes({ view }: EmptyThemesProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  if (view.empty === 'no_data') {
    return <EmptyState>{t('panel.quality.empty.placeNoData')}</EmptyState>;
  }
  return (
    <EmptyState>
      {view.stays === null
        ? t('panel.quality.empty.noThemesNoStays')
        : t('panel.quality.empty.noThemes', { stays: formatNumber(view.stays, language) })}
    </EmptyState>
  );
}

interface RepairsNoteProps {
  workFrom: string | null;
}

/** An old episode cannot be called unanswered: it may have been fixed before our records (§4.5). */
function RepairsNote({ workFrom }: RepairsNoteProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <p className="text-sm text-muted-foreground">
      {workFrom === null
        ? t('panel.quality.card.noRepairs')
        : t('panel.quality.card.repairsFrom', { day: formatShortDay(workFrom, language) })}
    </p>
  );
}

function PlaceCard({ card }: { card: QualityPlaceCard }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const view = placeCardOf(card);
  const ratingNote =
    card.grain === 'week'
      ? t('panel.quality.rating.threeMonths', { from: formatDay(card.rating_from, language) })
      : null;

  return (
    <>
      <PlaceFacts card={card} view={view} />
      <WindowCaption from={card.from} today={card.today} />
      {ratingNote === null ? null : <p className="text-sm text-muted-foreground">{ratingNote}</p>}
      <ReadingBand reading={view.reading} />
      <StaysBand coverage={view.coverage} loadedFrom={staysFromOf(card)} />
      <ShortWindowBand grain={card.grain} />
      {view.empty === null ? (
        <>
          {view.hasOldEpisodes ? <RepairsNote workFrom={card.work_from} /> : null}
          <ThemesBlock
            title={t('panel.quality.card.important')}
            lines={view.important}
            emptyText={t('panel.quality.card.noImportant')}
          />
          {view.others.length === 0 ? null : (
            <ThemesBlock title={t('panel.quality.card.others')} lines={view.others} />
          )}
        </>
      ) : (
        <EmptyThemes view={view} />
      )}
      <MonthChart bars={view.months} />
      <RatingsBlock
        channels={card.channels}
        categories={card.categories}
        peersCity={card.city_groups ? card.place.city : null}
        note={ratingNote}
      />
    </>
  );
}

/**
 * A place's card (docs/property-intelligence-plan.md §6.2), read only: what
 * matters now, the rest, its year by month, its ratings. Its window lives in the
 * address and comes along from the overview and back.
 */
export function QualityPlaceView({ placeId }: { placeId: number }) {
  const { t } = useTranslation();
  const [window, setWindow] = useAddressState(readQualityWindow, writeQualityWindow);
  const read = useQualityPlace(placeId, window);
  const back = { href: qualityHref(window), label: t('panel.nav.quality') };
  const bar = <WindowBar value={window} onChange={(next) => setWindow(next)} />;

  if (read.isError) {
    return (
      <div className="flex flex-col gap-4">
        <PageBackLink {...back} />
        {bar}
        <ErrorState message={t('panel.quality.errors.place')} error={read.error} />
      </div>
    );
  }
  if (read.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <PageBackLink {...back} />
        {bar}
        <LoadingState>{t('common.loading')}</LoadingState>
      </div>
    );
  }
  if (read.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          back={back}
          title={t('panel.quality.card.notFoundTitle')}
          description={t('panel.quality.card.notFoundText')}
        />
      </div>
    );
  }

  const { place } = read.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={back} title={place.name} description={place.city ?? undefined} />
      {bar}
      <PlaceCard card={read.data} />
    </div>
  );
}
