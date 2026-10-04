'use client';

import { Search } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

import { EMPTY_FILTERS, hasFilters, TASK_TYPES, type Staff, type TaskFilters } from './schema';

interface TasksFiltersProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  /** The people a job can be on; empty while they load. */
  staff: readonly Staff[];
}

/** A control with its name written above it, small, as the filters of the comparison page have. */
function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * The filter bar of «Уборки» (5.4, variant A): a search, who, what, and a
 * date range whose two ends say which is which. Each control is 44 px high
 * (`TOUCH_TARGET.panelMin`). On a wide screen the bar stays at the top while
 * the table scrolls under it; on a phone it would take half the screen, so
 * there it scrolls away with the rest.
 */
export function TasksFilters({ filters, onChange, staff }: TasksFiltersProps) {
  const { t } = useTranslation();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;
  const set = (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch });

  return (
    <div
      data-slot="tasks-filters"
      className="flex flex-wrap items-end gap-3 bg-background py-2 md:sticky md:top-0 md:z-10"
    >
      <div className="relative w-full sm:w-auto sm:min-w-72 sm:flex-1 lg:max-w-md">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => set({ query: event.target.value })}
          placeholder={t('panel.tasks.filters.search')}
          aria-label={t('panel.tasks.filters.search')}
          className="h-11 pl-9"
        />
      </div>
      <Labelled id={field('assignee')} label={t('panel.tasks.filters.assignee')}>
        <NativeSelect
          id={field('assignee')}
          className="h-11 max-w-56"
          value={filters.assigneeId}
          onChange={(event) => set({ assigneeId: event.target.value })}
        >
          <option value="all">{t('panel.tasks.filters.anyAssignee')}</option>
          <option value="nobody">{t('panel.tasks.filters.nobody')}</option>
          {staff.map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name ?? person.id}
            </option>
          ))}
        </NativeSelect>
      </Labelled>
      <Labelled id={field('type')} label={t('panel.tasks.filters.type')}>
        <NativeSelect
          id={field('type')}
          className="h-11"
          value={filters.type}
          onChange={(event) => set({ type: event.target.value as TaskFilters['type'] })}
        >
          <option value="all">{t('panel.tasks.filters.anyType')}</option>
          {TASK_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`panel.tasks.types.${type}`)}
            </option>
          ))}
        </NativeSelect>
      </Labelled>
      <Labelled id={field('from')} label={t('panel.tasks.filters.dateFrom')}>
        <Input
          id={field('from')}
          type="date"
          className="h-11 w-40"
          value={filters.dateFrom}
          max={filters.dateTo === '' ? undefined : filters.dateTo}
          onChange={(event) => set({ dateFrom: event.target.value })}
        />
      </Labelled>
      <Labelled id={field('to')} label={t('panel.tasks.filters.dateTo')}>
        <Input
          id={field('to')}
          type="date"
          className="h-11 w-40"
          value={filters.dateTo}
          min={filters.dateFrom === '' ? undefined : filters.dateFrom}
          onChange={(event) => set({ dateTo: event.target.value })}
        />
      </Labelled>
      {hasFilters(filters) ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          {t('panel.tasks.filters.reset')}
        </Button>
      ) : null}
    </div>
  );
}
