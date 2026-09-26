'use client';

import { useMemo, useState } from 'react';

import type { CalendarTask, ExpiredTask, Property } from '@/features/tasks/schema';
import type { Client } from '@/lib/supabase/use-client';

import {
  ANY_ASSIGNEE,
  collapseExpired,
  expiredAsTask,
  matchesChipFilters,
  offListAssignees,
  tasksByRowDay,
  type AssigneeFilter,
  type StatusFilter,
} from './chips';
import {
  useCalendarCancelled,
  useCalendarExpired,
  useCalendarStaff,
  useCalendarTasks,
} from './use-calendar';

/** A layer that could not be read, and the sentence that says which. */
export interface LayerFailure {
  messageKey: string;
  error: unknown;
}

interface ChipLayersOptions {
  client: Client | null;
  isStand: boolean;
  days: readonly string[];
  byId: ReadonlyMap<number, Property>;
}

/**
 * The chips of the window, all their layers as one (docs/f10-plan.md, 7.4,
 * 7.5): the live and the done; what never happened, one mark per booking;
 * the cancelled while their switch is on. The filters act on the result:
 * «Статус» on the live and the done only, the assignee on all (§2).
 */
export function useChipLayers({ client, isStand, days, byId }: ChipLayersOptions) {
  const tasks = useCalendarTasks(client, isStand, days);
  const expired = useCalendarExpired(client, isStand, days);
  const [showCancelled, setShowCancelled] = useState(false);
  const cancelled = useCalendarCancelled(client, isStand, days, showCancelled);
  const staff = useCalendarStaff(client, isStand);

  const [status, setStatus] = useState<StatusFilter>('all');
  const [assignee, setAssignee] = useState<AssigneeFilter>(ANY_ASSIGNEE);

  // A mark is read narrow: its person's name comes from what is already held.
  const names = useMemo(() => {
    const known = new Map<string, string>();
    for (const person of staff.data ?? []) {
      if (person.full_name !== null) {
        known.set(person.id, person.full_name);
      }
    }
    for (const task of tasks.data ?? []) {
      if (task.assignee_id !== null && task.assignee?.full_name) {
        known.set(task.assignee_id, task.assignee.full_name);
      }
    }
    return known;
  }, [staff.data, tasks.data]);

  const asChip = useMemo(
    () => (row: ExpiredTask) =>
      expiredAsTask(
        row,
        (id) => byId.get(id)?.name,
        (id) => names.get(id),
      ),
    [byId, names],
  );

  // The assignee filter picks the copies before they fold: a mark stands for
  // whoever any of its copies carried, not only the copy chosen to stand.
  const marks = useMemo(
    () =>
      collapseExpired(
        (expired.data ?? []).filter((row) =>
          matchesChipFilters({ status: 'expired', assignee_id: row.assignee_id }, 'all', assignee),
        ),
      ).map(asChip),
    [expired.data, assignee, asChip],
  );

  const live = useMemo<CalendarTask[]>(
    () => [...(tasks.data ?? []), ...(showCancelled ? (cancelled.data ?? []) : [])],
    [tasks.data, showCancelled, cancelled.data],
  );

  const byRowDay = useMemo(
    () =>
      tasksByRowDay([
        ...live.filter((task) => matchesChipFilters(task, status, assignee)),
        ...marks,
      ]),
    [live, marks, status, assignee],
  );

  // Everybody on any chip of the window, every copy of a mark included.
  const offList = useMemo(
    () =>
      staff.data === undefined
        ? []
        : offListAssignees([...live, ...(expired.data ?? []).map(asChip)], staff.data),
    [live, expired.data, asChip, staff.data],
  );
  // A person who left, once chosen, keeps an option after the window moves
  // past their chips: otherwise the select shows «Все» over an empty grid.
  const [chosen, setChosen] = useState<{ id: string; name: string | null } | null>(null);
  const chooseAssignee = (next: AssigneeFilter) => {
    setAssignee(next);
    setChosen(offList.find((person) => person.id === next) ?? null);
  };
  const shownOffList =
    chosen !== null &&
    chosen.id === assignee &&
    !offList.some((person) => person.id === assignee) &&
    !(staff.data ?? []).some((person) => person.id === assignee)
      ? [...offList, chosen]
      : offList;

  const layers = [
    { layer: tasks, messageKey: 'panel.calendar.tasksError' },
    { layer: expired, messageKey: 'panel.calendar.expiredError' },
    ...(showCancelled ? [{ layer: cancelled, messageKey: 'panel.calendar.cancelledError' }] : []),
  ];

  return {
    byRowDay,
    isPending: layers.some(({ layer }) => layer.isPending),
    failures: layers
      .filter(({ layer }) => layer.isError)
      .map(({ layer, messageKey }): LayerFailure => ({ messageKey, error: layer.error })),
    filters: {
      status,
      onStatus: setStatus,
      assignee,
      onAssignee: chooseAssignee,
      staff: staff.data ?? [],
      offList: shownOffList,
      showCancelled,
      onShowCancelled: setShowCancelled,
    },
  };
}
