'use client';

import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { Staff } from '@/features/tasks/schema';

import {
  ANY_ASSIGNEE,
  NO_ASSIGNEE,
  STATUS_FILTERS,
  type AssigneeFilter,
  type StatusFilter,
} from './chips';

const SELECT_CLASS = 'h-8 rounded-md border bg-background px-2 text-sm';

const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

interface CalendarFiltersProps {
  status: StatusFilter;
  onStatus: (next: StatusFilter) => void;
  assignee: AssigneeFilter;
  onAssignee: (next: AssigneeFilter) => void;
  /** The working staff, alphabetical. */
  staff: readonly Staff[];
  /** People on the chips who are no longer working, marked apart; a name may be unknown. */
  offList: readonly { id: string; name: string | null }[];
  /** The cancelled are hidden until this is on (§2); «Статус» does not reach them. */
  showCancelled: boolean;
  onShowCancelled: (next: boolean) => void;
  onNewTask: () => void;
}

/**
 * The chips' filters (docs/f10-plan.md, §2, 7.4): «Статус» over the live and
 * the done, and the assignee — everybody, nobody, or one person. They act on
 * the chips only; the bars stay.
 */
export function CalendarFilters({
  status,
  onStatus,
  assignee,
  onAssignee,
  staff,
  offList,
  showCancelled,
  onShowCancelled,
  onNewTask,
}: CalendarFiltersProps) {
  const { t } = useTranslation();
  const people = [...staff].sort((a, b) =>
    collator.compare(a.full_name ?? a.id, b.full_name ?? b.id),
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="calendar-status">{t('panel.calendar.filters.status')}</Label>
      <select
        id="calendar-status"
        className={SELECT_CLASS}
        value={status}
        onChange={(event) => onStatus(event.target.value as StatusFilter)}
      >
        {STATUS_FILTERS.map((one) => (
          <option key={one} value={one}>
            {t(`panel.calendar.filters.${one}`)}
          </option>
        ))}
      </select>

      <Label htmlFor="calendar-assignee">{t('panel.tasks.filters.assignee')}</Label>
      <select
        id="calendar-assignee"
        className={SELECT_CLASS}
        value={assignee}
        onChange={(event) => onAssignee(event.target.value)}
      >
        <option value={ANY_ASSIGNEE}>{t('panel.calendar.filters.all')}</option>
        <option value={NO_ASSIGNEE}>{t('panel.calendar.filters.nobody')}</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.full_name ?? person.id}
          </option>
        ))}
        {offList.map((person) => (
          <option key={person.id} value={person.id}>
            {t('panel.tasks.form.assigneeInactive', {
              name: person.name ?? t('panel.apartments.bookings.noName'),
            })}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={showCancelled}
          onChange={(event) => onShowCancelled(event.target.checked)}
        />
        {t('panel.calendar.showCancelled')}
      </label>

      <Button type="button" size="sm" className="ml-auto" onClick={onNewTask}>
        {t('panel.tasks.actions.new')}
      </Button>
    </div>
  );
}
