'use client';

import { INTL_LOCALES, type Language } from '@str-ops/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { MultiSelectFilter, type MultiSelectOption } from '@/components/multi-select-filter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { dateFormat, todayIn } from '@/lib/format-date';

import {
  EMPTY_REVIEW_FILTERS,
  hasReviewFilters,
  LOW_RATING_MAX,
  RATING_MAX,
  RATING_MIN,
  recentMonths,
  REVIEW_CATEGORIES,
  REVIEW_CHANNELS,
  REVIEW_FINDING_FILTERS,
  type LowCategory,
  type ReviewChannel,
  type ReviewFilters,
  type ReviewFindingFilter,
} from './review-filters';
import { TEXTS_LINE_TIME_ZONE } from './schema';

/** Two years of months to pick a period from: the reviews of the first load reach a year back. */
export const PERIOD_MONTHS = 24;

interface ReviewFiltersBarProps {
  filters: ReviewFilters;
  onChange: (filters: ReviewFilters) => void;
  /** The listings a review may be on, archived ones marked; empty while they load. */
  places: readonly MultiSelectOption[];
  language: Language;
}

/** "октябрь 2026 г." for `2026-10`, in the panel's language. */
function monthLabel(month: string, language: Language): string {
  const [year, number] = month.split('-').map(Number);
  return dateFormat(INTL_LOCALES[language], { month: 'long', year: 'numeric' }).format(
    new Date(year, number - 1, 1),
  );
}

function capitalized(text: string, language: Language): string {
  return text.charAt(0).toLocaleUpperCase(INTL_LOCALES[language]) + text.slice(1);
}

/** A number typed into a rating field, held to the scale; empty is no bound. */
function ratingOf(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(Math.max(number, RATING_MIN), RATING_MAX);
}

/**
 * The filters of «Все отзывы»: every one narrows the list on the server, and
 * they all hold at once. Built like the other filter bars of the panel — a
 * button per long list, a labelled field per value, a box per yes-or-no, one
 * button that clears them all.
 */
export function ReviewFiltersBar({ filters, onChange, places, language }: ReviewFiltersBarProps) {
  const { t } = useTranslation();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const set = (patch: Partial<ReviewFilters>) => onChange({ ...filters, ...patch });
  const months = recentMonths(todayIn(TEXTS_LINE_TIME_ZONE), PERIOD_MONTHS);
  const isLowOnly = filters.ratingMin === null && filters.ratingMax === LOW_RATING_MAX;

  const channels = REVIEW_CHANNELS.map((channel) => ({
    id: channel,
    label: t(`panel.guests.channel.${channel}`),
  }));
  const findings = REVIEW_FINDING_FILTERS.map((tab) => ({
    id: tab,
    label: t(`panel.guests.tabs.${tab}`),
  }));
  const flags = [
    ['withText', 'panel.guests.filters.withText'],
    ['withPrivate', 'panel.guests.filters.withPrivate'],
    ['hiddenOnly', 'panel.guests.filters.hiddenOnly'],
  ] as const;

  return (
    <div data-slot="review-filters" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <MultiSelectFilter
          label={t('panel.guests.filters.channel')}
          options={channels}
          isFixedSet
          selected={filters.channels}
          onChange={(next) => set({ channels: next as ReviewChannel[] })}
        />
        <MultiSelectFilter
          label={t('panel.guests.filters.place')}
          options={places}
          selected={filters.placeIds.map(String)}
          onChange={(next) => set({ placeIds: next.map(Number) })}
          wholeMeansAll
        />
        <MultiSelectFilter
          label={t('panel.guests.filters.findings')}
          options={findings}
          isFixedSet
          selected={filters.findings}
          onChange={(next) => set({ findings: next as ReviewFindingFilter[] })}
        />
        <LabelledField id={field('rating-from')} label={t('panel.guests.filters.ratingFrom')}>
          <Input
            id={field('rating-from')}
            type="number"
            inputMode="numeric"
            min={RATING_MIN}
            max={RATING_MAX}
            step={1}
            className="h-11 w-24"
            value={filters.ratingMin ?? ''}
            onChange={(event) => set({ ratingMin: ratingOf(event.target.value) })}
          />
        </LabelledField>
        <LabelledField id={field('rating-to')} label={t('panel.guests.filters.ratingTo')}>
          <Input
            id={field('rating-to')}
            type="number"
            inputMode="numeric"
            min={RATING_MIN}
            max={RATING_MAX}
            step={1}
            className="h-11 w-24"
            value={filters.ratingMax ?? ''}
            onChange={(event) => set({ ratingMax: ratingOf(event.target.value) })}
          />
        </LabelledField>
        <Button
          type="button"
          variant={isLowOnly ? 'secondary' : 'outline'}
          className="h-11"
          aria-pressed={isLowOnly}
          onClick={() =>
            set(
              isLowOnly
                ? { ratingMin: null, ratingMax: null }
                : { ratingMin: null, ratingMax: LOW_RATING_MAX },
            )
          }
        >
          {t('panel.guests.filters.low', { max: LOW_RATING_MAX })}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <LabelledField id={field('month-from')} label={t('panel.guests.filters.monthFrom')}>
          <NativeSelect
            id={field('month-from')}
            className="h-11 max-w-56"
            value={filters.monthFrom ?? ''}
            onChange={(event) => set({ monthFrom: event.target.value || null })}
          >
            <option value="">{t('panel.guests.filters.anyMonth')}</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month, language)}
              </option>
            ))}
          </NativeSelect>
        </LabelledField>
        <LabelledField id={field('month-to')} label={t('panel.guests.filters.monthTo')}>
          <NativeSelect
            id={field('month-to')}
            className="h-11 max-w-56"
            value={filters.monthTo ?? ''}
            onChange={(event) => set({ monthTo: event.target.value || null })}
          >
            <option value="">{t('panel.guests.filters.anyMonth')}</option>
            {months.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month, language)}
              </option>
            ))}
          </NativeSelect>
        </LabelledField>
        <LabelledField id={field('low-category')} label={t('panel.guests.filters.lowCategory')}>
          <NativeSelect
            id={field('low-category')}
            className="h-11 max-w-64"
            value={filters.lowCategory ?? ''}
            onChange={(event) =>
              set({ lowCategory: (event.target.value || null) as LowCategory | null })
            }
          >
            <option value="">{t('panel.guests.filters.lowCategoryNone')}</option>
            <option value="any">{t('panel.guests.filters.lowCategoryAny')}</option>
            {REVIEW_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {capitalized(t(`panel.guests.category.${category}`), language)}
              </option>
            ))}
          </NativeSelect>
        </LabelledField>
        {flags.map(([name, label]) => (
          <label
            key={name}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted/60"
          >
            <input
              type="checkbox"
              className="size-4"
              checked={filters[name]}
              onChange={() => set({ [name]: !filters[name] })}
            />
            {t(label)}
          </label>
        ))}
        {hasReviewFilters(filters) ? (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            onClick={() => onChange(EMPTY_REVIEW_FILTERS)}
          >
            {t('panel.guests.filters.reset')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
