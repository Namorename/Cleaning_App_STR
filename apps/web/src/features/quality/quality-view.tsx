'use client';

import { GROUP_MIN_PLACES } from '@str-ops/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { formatNumber } from '@/features/analytics/format';
import { formatDay } from '@/lib/format-date';
import { useAddressState } from '@/lib/use-address-state';
import { useLanguage } from '@/lib/use-language';

import { readQualityAddress, writeQualityAddress, type QualityAddress } from './address';
import { ReadingBand, ShortWindowBand, StaysBand } from './bands';
import { PlacesTable } from './places-table';
import type { QualityOverview } from './schema';
import { ScopeBlock } from './scope-block';
import { staysFromOf } from './theme-model';
import { PortfolioTiles } from './tiles';
import { useQualityOverview } from './use-quality';
import { overviewOf, type OverviewView } from './view-model';
import { WindowBar, WindowCaption } from './window-bar';

interface FiltersProps {
  address: QualityAddress;
  cities: readonly string[];
  /** The city the screen is narrowed to: one the address names and the answer has. */
  city: string | null;
  onChange: (next: QualityAddress) => void;
}

function Filters({ address, cities, city, onChange }: FiltersProps) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <LabelledField id={id} label={t('panel.quality.filters.city')}>
        <NativeSelect
          id={id}
          className="h-11 max-w-full"
          value={city ?? ''}
          onChange={(event) => onChange({ ...address, city: event.target.value || null })}
        >
          <option value="">{t('panel.quality.filters.allCities')}</option>
          {cities.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </NativeSelect>
      </LabelledField>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Switch
          checked={address.onlyNew}
          onCheckedChange={(onlyNew) => onChange({ ...address, onlyNew })}
        />
        {t('panel.quality.filters.onlyNew')}
      </label>
    </div>
  );
}

/** Why the window has nothing to show: «0 тем» on 3 stays and on 300 are different things (§6.4). */
function EmptyWindow({ view }: { view: OverviewView }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { empty, tiles } = view;

  if (empty === null) {
    return null;
  }
  if (empty === 'no_places') {
    return <EmptyState>{t('panel.quality.empty.noPlaces')}</EmptyState>;
  }
  if (empty === 'no_data') {
    return <EmptyState>{t('panel.quality.empty.noData')}</EmptyState>;
  }
  return (
    <EmptyState>
      {tiles.stays === null
        ? t('panel.quality.empty.noThemesNoStays')
        : t('panel.quality.empty.noThemes', { stays: formatNumber(tiles.stays, language) })}
    </EmptyState>
  );
}

interface OverviewProps {
  data: QualityOverview;
  address: QualityAddress;
  onChange: (next: QualityAddress) => void;
}

function Overview({ data, address, onChange }: OverviewProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const view = overviewOf(data, address);
  const { city, group } = view;
  const ratingNote =
    data.grain === 'week'
      ? t('panel.quality.rating.threeMonths', { from: formatDay(data.rating_from, language) })
      : null;

  return (
    <>
      <WindowCaption from={data.from} today={data.today} />
      <ReadingBand reading={view.reading} />
      <StaysBand coverage={view.coverage} loadedFrom={staysFromOf(data)} />
      <ShortWindowBand grain={data.grain} />
      <Filters address={address} cities={view.cities} city={city} onChange={onChange} />
      <PortfolioTiles tiles={view.tiles} ratingNote={ratingNote} />
      <EmptyWindow view={view} />
      {view.portfolio.hasThemes ? (
        <ScopeBlock title={t('panel.quality.scope.portfolio')} scope={view.portfolio} />
      ) : null}
      {group === null ? null : (
        <ScopeBlock title={t('panel.quality.scope.group', { city })} scope={group} />
      )}
      {city !== null && group === null ? (
        <EmptyState>
          {t('panel.quality.scope.groupTooSmall', { city, min: GROUP_MIN_PLACES })}
        </EmptyState>
      ) : null}
      {view.empty === 'no_places' ? null : <PlacesTable rows={view.rows} window={data.window} />}
    </>
  );
}

/**
 * «Качество объектов» (docs/property-intelligence-plan.md §6.2): the portfolio
 * of one window, read only. The window, the city and «только новое» live in the
 * address, and a change is made in place: «Назад» leaves the screen.
 */
export function QualityView() {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readQualityAddress, writeQualityAddress);
  const read = useQualityOverview(address.window);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.nav.quality')} description={t('panel.quality.subtitle')} />
      <WindowBar value={address.window} onChange={(window) => setAddress({ ...address, window })} />
      {read.isError ? (
        <ErrorState message={t('panel.quality.errors.overview')} error={read.error} />
      ) : read.data === undefined ? (
        <LoadingState>{t('common.loading')}</LoadingState>
      ) : (
        <Overview data={read.data} address={address} onChange={setAddress} />
      )}
    </div>
  );
}
