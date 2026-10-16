'use client';

import { Constants } from '@str-ops/shared';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
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

/**
 * One filter: a disclosure with a checkbox per value; none ticked means "all".
 * It closes on Escape (the focus goes back to its button) and on a press
 * anywhere outside it, so opening the next filter closes this one.
 */
function FilterGroup({ label, options, selected, onChange }: FilterGroupProps) {
  const id = useId();
  const [isOpen, setIsOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const button = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const closeOutside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [isOpen]);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      button.current?.focus();
    }
  };
  // The keyboard's way out: the focus moving on to something else. A focus
  // that just leaves (Safari ticks a checkbox without focusing it) is not one.
  const closeOnFocusAway = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (isOpen && next !== null && !root.current?.contains(next)) {
      setIsOpen(false);
    }
  };
  const toggle = (value: string) =>
    onChange(
      selected.includes(value) ? selected.filter((one) => one !== value) : [...selected, value],
    );
  return (
    <details
      ref={root}
      open={isOpen}
      onKeyDown={closeOnEscape}
      onBlur={closeOnFocusAway}
      className="group relative"
    >
      <summary
        ref={button}
        // The page holds the state: the browser's own toggle would undo it.
        onClick={(event) => {
          event.preventDefault();
          setIsOpen((open) => !open);
        }}
        className="flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted/60"
      >
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

  const chips = [
    ...filters.propertyIds.map((value) => ({
      key: `prop-${value}`,
      label: listingNames.find((one) => one.id === String(value))?.label ?? String(value),
      remove: () => onChange({ ...filters, propertyIds: filters.propertyIds.filter((v) => v !== value) }),
    })),
    ...filters.personIds.map((value) => ({
      key: `ppl-${value}`,
      // Somebody no longer on the team (a chart still counts her work) is
      // named as what she is, never by an id.
      label:
        people.find((one) => one.id === value)?.label ??
        staff?.find((one) => one.id === value)?.label ??
        // Until the team has loaded, nobody can be called a former employee.
        (staff === null ? t('panel.analytics.charts.loading') : t(`${KEY}formerEmployee`)),
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
