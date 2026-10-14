'use client';

import { Constants } from '@str-ops/shared';
import { X } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { NO_FILTERS, type AnalyticsFilters } from './schema';

export interface FilterOption {
  id: string;
  label: string;
}

interface FilterGroupProps {
  label: string;
  options: readonly FilterOption[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

/** One filter: a disclosure with a checkbox per value; none ticked means "all". */
function FilterGroup({ label, options, selected, onChange }: FilterGroupProps) {
  const id = useId();
  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((one) => one !== value) : [...selected, value],
    );
  return (
    <details className="group relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted/60">
        {label}
        {selected.length === 0 ? null : (
          <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
            {selected.length}
          </span>
        )}
      </summary>
      <fieldset className="absolute z-20 mt-1 flex max-h-72 w-64 flex-col gap-1 overflow-y-auto rounded-lg bg-popover p-2 shadow-md ring-1 ring-foreground/10">
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label
            key={option.id}
            htmlFor={`${id}-${option.id}`}
            className="flex min-h-11 items-center gap-2 rounded px-2 text-sm hover:bg-muted/60"
          >
            <input
              id={`${id}-${option.id}`}
              type="checkbox"
              className="size-4"
              checked={selected.includes(option.id)}
              onChange={() => toggle(option.id)}
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </fieldset>
    </details>
  );
}

interface FiltersBarProps {
  filters: AnalyticsFilters;
  listings: readonly FilterOption[];
  people: readonly FilterOption[];
  onChange: (next: AnalyticsFilters) => void;
}

/**
 * The page's filters — listing, person, cleaning status, task status, urgency
 * — and a chip for every value in force, each with its own way out. A chart
 * that is clicked sets the same filters (cross-filter).
 */
export function FiltersBar({ filters, listings, people, onChange }: FiltersBarProps) {
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

  const chips = [
    ...filters.propertyIds.map((value) => ({
      key: `prop-${value}`,
      label: listings.find((one) => one.id === String(value))?.label ?? String(value),
      remove: () => onChange({ ...filters, propertyIds: filters.propertyIds.filter((v) => v !== value) }),
    })),
    ...filters.personIds.map((value) => ({
      key: `ppl-${value}`,
      label: people.find((one) => one.id === value)?.label ?? value,
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
        <FilterGroup
          label={t(`${KEY}listings`)}
          options={listings}
          selected={filters.propertyIds.map(String)}
          onChange={(next) => onChange({ ...filters, propertyIds: next.map(Number) })}
        />
        <FilterGroup
          label={t(`${KEY}people`)}
          options={people}
          selected={filters.personIds}
          onChange={(next) => onChange({ ...filters, personIds: next })}
        />
        <FilterGroup
          label={t(`${KEY}cleaningStatus`)}
          options={taskStatuses}
          selected={filters.taskStatuses}
          onChange={(next) =>
            onChange({ ...filters, taskStatuses: next as AnalyticsFilters['taskStatuses'] })
          }
        />
        <FilterGroup
          label={t(`${KEY}taskStatus`)}
          options={problemStatuses}
          selected={filters.problemStatuses}
          onChange={(next) =>
            onChange({ ...filters, problemStatuses: next as AnalyticsFilters['problemStatuses'] })
          }
        />
        <FilterGroup
          label={t(`${KEY}urgency`)}
          options={priorities}
          selected={filters.priorities}
          onChange={(next) =>
            onChange({ ...filters, priorities: next as AnalyticsFilters['priorities'] })
          }
        />
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
