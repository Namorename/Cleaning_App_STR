'use client';

import { Constants } from '@str-ops/shared';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MultiSelectFilter } from '@/components/multi-select-filter';
import { Button } from '@/components/ui/button';

import { listingFilterLabel, personFilterLabel, type FilterOption } from './filter-labels';
import { NO_FILTERS, type AnalyticsFilters } from './schema';
import { wholeAsAll } from './whole-lists';

export type { FilterOption } from './filter-labels';

interface FiltersBarProps {
  filters: AnalyticsFilters;
  /** The listings the filter offers. */
  listings: readonly FilterOption[];
  /** Every listing, the archived ones the switch hides too: the names a chip can show. */
  listingNames: readonly FilterOption[];
  /** The people the filter offers: those who clean and repair. */
  people: readonly FilterOption[];
  /** Everyone on the team now, managers too: the names a chip can show; null while loading. */
  staff: readonly FilterOption[] | null;
  onChange: (next: AnalyticsFilters) => void;
}

/**
 * The page's filters — listing, person, cleaning status, task status, urgency,
 * the archived listings — and a chip for every value in force, each with its
 * own way out. A chart that is clicked sets the same filters (cross-filter).
 */
export function FiltersBar({
  filters,
  listings,
  listingNames,
  people,
  staff,
  onChange,
}: FiltersBarProps) {
  const { t } = useTranslation();
  const KEY = 'panel.analytics.filters.';

  const taskStatuses = Constants.public.Enums.task_status.map((status) => ({
    id: status,
    label: t(`panel.tasks.statuses.${status}`),
  }));
  const problemStatuses = Constants.public.Enums.problem_status.map((status) => ({
    id: status,
    label: t(`problems.statuses.${status}`),
  }));
  const priorities = Constants.public.Enums.problem_priority.map((priority) => ({
    id: priority,
    label: t(`problems.priorities.${priority}`),
  }));

  // A list ticked whole narrows nothing (whole-lists.ts): it has no chips.
  const chipListings = wholeAsAll(
    filters.propertyIds,
    listings.map((option) => Number(option.id)),
  );
  const chipPeople = wholeAsAll(
    filters.personIds,
    people.map((option) => option.id),
  );
  const chips = [
    ...chipListings.map((value) => ({
      key: `prop-${value}`,
      label: listingFilterLabel(value, listingNames),
      remove: () => onChange({ ...filters, propertyIds: filters.propertyIds.filter((v) => v !== value) }),
    })),
    ...chipPeople.map((value) => ({
      key: `ppl-${value}`,
      label: personFilterLabel(value, people, staff, (key, values) => t(key, values)),
      remove: () => onChange({ ...filters, personIds: filters.personIds.filter((v) => v !== value) }),
    })),
    ...filters.taskStatuses.map((value) => ({
      key: `st-${value}`,
      label: t(`panel.tasks.statuses.${value}`),
      remove: () => onChange({ ...filters, taskStatuses: filters.taskStatuses.filter((v) => v !== value) }),
    })),
    ...filters.problemStatuses.map((value) => ({
      key: `pst-${value}`,
      label: t(`problems.statuses.${value}`),
      remove: () =>
        onChange({ ...filters, problemStatuses: filters.problemStatuses.filter((v) => v !== value) }),
    })),
    ...filters.priorities.map((value) => ({
      key: `urg-${value}`,
      label: t(`problems.priorities.${value}`),
      remove: () => onChange({ ...filters, priorities: filters.priorities.filter((v) => v !== value) }),
    })),
  ];

  return (
    <section aria-label={t(`${KEY}label`)} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <MultiSelectFilter
          label={t(`${KEY}listings`)}
          options={listings}
          selected={filters.propertyIds.map(String)}
          onChange={(next) => onChange({ ...filters, propertyIds: next.map(Number) })}
          wholeMeansAll
        />
        <MultiSelectFilter
          label={t(`${KEY}people`)}
          options={people}
          selected={filters.personIds}
          onChange={(next) => onChange({ ...filters, personIds: next })}
          wholeMeansAll
        />
        <MultiSelectFilter
          label={t(`${KEY}cleaningStatus`)}
          options={taskStatuses}
          isFixedSet
          selected={filters.taskStatuses}
          onChange={(next) =>
            onChange({ ...filters, taskStatuses: next as AnalyticsFilters['taskStatuses'] })
          }
        />
        <MultiSelectFilter
          label={t(`${KEY}taskStatus`)}
          options={problemStatuses}
          isFixedSet
          selected={filters.problemStatuses}
          onChange={(next) =>
            onChange({ ...filters, problemStatuses: next as AnalyticsFilters['problemStatuses'] })
          }
        />
        <MultiSelectFilter
          label={t(`${KEY}urgency`)}
          options={priorities}
          isFixedSet
          selected={filters.priorities}
          onChange={(next) =>
            onChange({ ...filters, priorities: next as AnalyticsFilters['priorities'] })
          }
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted/60">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.hideArchived}
            onChange={() => onChange({ ...filters, hideArchived: !filters.hideArchived })}
          />
          {t(`${KEY}hideArchived`)}
        </label>
      </div>
      {chips.length === 0 ? null : (
        <ul className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Button
                type="button"
                variant="secondary"
                className="h-11 gap-1 px-3"
                aria-label={t(`${KEY}remove`, { name: chip.label })}
                onClick={chip.remove}
              >
                {chip.label}
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </li>
          ))}
          <li>
            <Button type="button" variant="ghost" className="h-11" onClick={() => onChange(NO_FILTERS)}>
              {t(`${KEY}clear`)}
            </Button>
          </li>
        </ul>
      )}
    </section>
  );
}
