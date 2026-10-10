'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

import {
  ANY_ASSIGNEE,
  ANY_PLACE,
  EMPTY_PROBLEM_FILTERS,
  hasProblemFilters,
  NO_ASSIGNEE,
  NO_PLACE,
  type AssigneeOption,
  type PlaceFilter,
  type PlaceOption,
  type ProblemFilters,
} from './filters';

interface ProblemsFiltersProps {
  filters: ProblemFilters;
  onChange: (filters: ProblemFilters) => void;
  /** Every place a task stands on, each house followed by its rooms. */
  places: readonly PlaceOption[];
  /** The people on a live repair. */
  people: readonly AssigneeOption[];
}

/**
 * The select's own values: the two fixed choices bare, a place behind a
 * prefix — a listing's name can be anything, `all` and `none` included.
 */
const PLACE_VALUE = { all: 'all', none: 'none', prefix: 'place:' } as const;

function placeValue(place: PlaceFilter): string {
  switch (place.kind) {
    case 'all':
      return PLACE_VALUE.all;
    case 'none':
      return PLACE_VALUE.none;
    case 'place':
      return `${PLACE_VALUE.prefix}${place.name}`;
  }
}

function placeFrom(value: string): PlaceFilter {
  if (value.startsWith(PLACE_VALUE.prefix)) {
    return { kind: 'place', name: value.slice(PLACE_VALUE.prefix.length) };
  }
  return value === PLACE_VALUE.none ? NO_PLACE : ANY_PLACE;
}

/**
 * The filter bar of «Задания» (owner, 10.10), built as «Уборки» build theirs
 * (`tasks-filters.tsx`): the listing, who holds the repair, and the days the
 * task was reported between — each named above its control, 44 px high
 * (`TOUCH_TARGET.panelMin`), and «Сбросить фильтры» while anything is set,
 * the search in the header included. The same bar stands over the board, the
 * list and the archive.
 */
export function ProblemsFilters({ filters, onChange, places, people }: ProblemsFiltersProps) {
  const { t } = useTranslation();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const set = (patch: Partial<ProblemFilters>) => onChange({ ...filters, ...patch });

  return (
    <div data-slot="problems-filters" className="flex flex-wrap items-end gap-3">
      <LabelledField id={field('place')} label={t('panel.problems.filters.place')}>
        <NativeSelect
          id={field('place')}
          className="h-11 max-w-72"
          value={placeValue(filters.place)}
          onChange={(event) => set({ place: placeFrom(event.target.value) })}
        >
          <option value={PLACE_VALUE.all}>{t('panel.problems.filters.anyPlace')}</option>
          <option value={PLACE_VALUE.none}>{t('problems.noProperty')}</option>
          {places.map((place) => (
            <option key={place.name} value={`${PLACE_VALUE.prefix}${place.name}`}>
              {place.name}
            </option>
          ))}
        </NativeSelect>
      </LabelledField>
      <LabelledField id={field('assignee')} label={t('panel.problems.filters.assignee')}>
        <NativeSelect
          id={field('assignee')}
          className="h-11 max-w-56"
          value={filters.assigneeId}
          onChange={(event) => set({ assigneeId: event.target.value })}
        >
          <option value={ANY_ASSIGNEE}>{t('panel.problems.filters.anyAssignee')}</option>
          <option value={NO_ASSIGNEE}>{t('panel.problems.filters.nobody')}</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name ?? t('panel.problems.unknownPerson')}
            </option>
          ))}
        </NativeSelect>
      </LabelledField>
      <LabelledField id={field('from')} label={t('panel.problems.filters.dateFrom')}>
        <Input
          id={field('from')}
          type="date"
          className="h-11 w-40"
          value={filters.dateFrom}
          max={filters.dateTo === '' ? undefined : filters.dateTo}
          onChange={(event) => set({ dateFrom: event.target.value })}
        />
      </LabelledField>
      <LabelledField id={field('to')} label={t('panel.problems.filters.dateTo')}>
        <Input
          id={field('to')}
          type="date"
          className="h-11 w-40"
          value={filters.dateTo}
          min={filters.dateFrom === '' ? undefined : filters.dateFrom}
          onChange={(event) => set({ dateTo: event.target.value })}
        />
      </LabelledField>
      {hasProblemFilters(filters) ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={() => onChange(EMPTY_PROBLEM_FILTERS)}
        >
          {t('panel.problems.filters.reset')}
        </Button>
      ) : null}
    </div>
  );
}
