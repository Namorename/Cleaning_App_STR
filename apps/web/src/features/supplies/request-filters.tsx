'use client';

import { Search } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { DateRange } from './schema';

interface RequestFiltersProps {
  query: string;
  dates: DateRange;
  onQueryChange: (query: string) => void;
  onDatesChange: (dates: DateRange) => void;
  /** Clear the search and both dates at once. */
  onReset: () => void;
}

/**
 * Above the list of requests (5.4, variant B): a search, and the two days a
 * request was made between, each with its name written over it — they were
 * two bare date fields. Every control is 44 px high (`TOUCH_TARGET.panelMin`).
 */
export function RequestFilters({
  query,
  dates,
  onQueryChange,
  onDatesChange,
  onReset,
}: RequestFiltersProps) {
  const { t } = useTranslation();
  const id = useId();
  const hasFilters = query.trim() !== '' || dates.from !== '' || dates.to !== '';

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          className="h-11 pl-9"
          placeholder={t('panel.supplies.search')}
          aria-label={t('panel.supplies.search')}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <LabelledField id={`${id}-from`} label={t('panel.supplies.filters.dateFrom')}>
          <Input
            id={`${id}-from`}
            type="date"
            className="h-11 w-40"
            value={dates.from}
            max={dates.to === '' ? undefined : dates.to}
            onChange={(event) => onDatesChange({ ...dates, from: event.target.value })}
          />
        </LabelledField>
        <LabelledField id={`${id}-to`} label={t('panel.supplies.filters.dateTo')}>
          <Input
            id={`${id}-to`}
            type="date"
            className="h-11 w-40"
            value={dates.to}
            min={dates.from === '' ? undefined : dates.from}
            onChange={(event) => onDatesChange({ ...dates, to: event.target.value })}
          />
        </LabelledField>
        {hasFilters ? (
          <Button type="button" variant="ghost" className="h-11" onClick={onReset}>
            {t('panel.supplies.filters.reset')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
