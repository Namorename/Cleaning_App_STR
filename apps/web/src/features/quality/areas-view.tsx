'use client';

import type { QualityWindow } from '@str-ops/shared';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { formatNumber } from '@/features/analytics/format';
import { formatShortDay } from '@/lib/format-date';
import { useAddressState } from '@/lib/use-address-state';
import { useLanguage } from '@/lib/use-language';

import { qualityHref, qualityPlaceHref, readQualityWindow, writeQualityWindow } from './address';
import {
  areasOf,
  type AreaPlace,
  type AreaPlaceLine,
  type AreaRow,
  type AreasModel,
} from './areas-model';
import { ReadingBand, ShortWindowBand } from './bands';
import type { QualityAreas, QualityOverview } from './schema';
import { SettledCaption, ThemeTrendMarks } from './theme-line';
import { useQualityAreas, useQualityOverview } from './use-quality';
import { WindowBar, WindowCaption } from './window-bar';

/** «3 из 40 заездов · гости»: one side's numbers, never added to the other's. */
function MemberLine({ line }: { line: AreaPlaceLine }) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <li className="text-sm text-muted-foreground">
      {t('panel.quality.areas.member', {
        n: formatNumber(line.episodes, language),
        count: line.stays,
      })}
      {' · '}
      {t(`panel.quality.areas.basis.${line.basis}`)}
    </li>
  );
}

function AreaPlaceItem({ place, window }: { place: AreaPlace; window: QualityWindow }) {
  return (
    <li className="flex min-w-0 flex-col">
      <Link
        href={qualityPlaceHref(place.id, window)}
        className="font-medium break-words underline-offset-4 hover:underline"
      >
        {place.name}
      </Link>
      <ul>
        {place.lines.map((line) => (
          <MemberLine key={line.basis} line={line} />
        ))}
      </ul>
    </li>
  );
}

function AreaItem({ row, window }: { row: AreaRow; window: QualityWindow }) {
  const { t } = useTranslation();
  const name = t(`panel.quality.themes.${row.theme}`);
  const { line, places } = row;

  return (
    <li>
      <section
        aria-label={name}
        className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="text-base font-semibold break-words">{name}</h2>
          <span className="text-sm text-muted-foreground">
            {t('panel.quality.areas.places', { count: places.length })}
          </span>
          {line === null ? null : <ThemeTrendMarks line={line} />}
        </div>
        {line === null ? null : <SettledCaption settledTo={line.settledTo} />}
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {places.map((place) => (
            <AreaPlaceItem key={place.id} place={place} window={window} />
          ))}
        </ul>
      </section>
    </li>
  );
}

/** Why there is no area to list: not counted yet, nothing to count on, or nothing stands out. */
function EmptyAreas({ model }: { model: AreasModel }) {
  const { t } = useTranslation();
  const language = useLanguage();

  if (model.empty === 'not_computed') {
    return <EmptyState>{t('panel.quality.areas.empty.notComputed')}</EmptyState>;
  }
  if (model.empty === 'stays_unknown') {
    return <EmptyState>{t('panel.quality.areas.empty.noStays')}</EmptyState>;
  }
  return (
    <EmptyState>
      {t('panel.quality.areas.empty.none', { stays: formatNumber(model.stays, language) })}
    </EmptyState>
  );
}

interface AreasProps {
  areas: QualityAreas;
  overview: QualityOverview;
}

function Areas({ areas, overview }: AreasProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const model = areasOf(areas, overview);

  return (
    <>
      <WindowCaption from={overview.from} today={overview.today} />
      {model.computedOn === null ? null : (
        <p className="text-sm text-muted-foreground">
          {t('panel.quality.areas.computedOn', {
            day: formatShortDay(model.computedOn, language),
          })}
        </p>
      )}
      <ReadingBand reading={model.reading} />
      <ShortWindowBand grain={overview.grain} />
      {model.empty === null ? (
        <>
          <p className="text-xs text-muted-foreground">{t('panel.quality.areas.dynamicsNote')}</p>
          <ul className="flex flex-col gap-3">
            {model.rows.map((row) => (
              <AreaItem key={row.theme} row={row} window={overview.window} />
            ))}
          </ul>
        </>
      ) : (
        <EmptyAreas model={model} />
      )}
    </>
  );
}

/**
 * «Области» (the owner's decision of 2026-11-06), read only: where a theme stands
 * out, by window. Its members come from the night's count, its dynamics from the
 * overview, so the two reads go out together and a failure of either is the screen's.
 */
export function AreasView() {
  const { t } = useTranslation();
  const [window, setWindow] = useAddressState(readQualityWindow, writeQualityWindow);
  const areas = useQualityAreas(window);
  const overview = useQualityOverview(window);
  const failed = [areas, overview].find((read) => read.isError);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={{ href: qualityHref(window), label: t('panel.nav.quality') }}
        title={t('panel.quality.areas.title')}
        description={t('panel.quality.areas.rule')}
      />
      <WindowBar value={window} onChange={(next) => setWindow(next)} />
      {failed !== undefined ? (
        <ErrorState message={t('panel.quality.errors.areas')} error={failed.error} />
      ) : areas.data === undefined || overview.data === undefined ? (
        <LoadingState>{t('common.loading')}</LoadingState>
      ) : (
        <Areas areas={areas.data} overview={overview.data} />
      )}
    </div>
  );
}
