'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@str-ops/shared';

import type { CalendarTask, TaskDraft } from '@/features/tasks/schema';
import { TaskDrawer } from '@/features/tasks/task-drawer';
import { TaskForm } from '@/features/tasks/task-form';
import { formatDay } from '@/lib/format-date';

import { CellTasksDialog, type CellTasks } from './cell-tasks-dialog';
import type { CalendarBooking } from './schema';
import { StandPreview } from './stand-preview';

type Start = Pick<TaskDraft, 'propertyId' | 'scheduledDate'>;

interface TaskDialogsOptions {
  isStand: boolean;
  language: Language;
  bookings: ReadonlyMap<number, CalendarBooking> | null;
}

/**
 * What a chip, «+N» and an empty day open (docs/f10-plan.md, 7.4): the task
 * form for an open task or a new one, the drawer for a done one. On the stand
 * writing is off (§5), so each opens a preview card instead.
 */
export function useTaskDialogs({ isStand, language, bookings }: TaskDialogsOptions) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ task: CalendarTask | null; start?: Start } | null>(null);
  const [reading, setReading] = useState<CalendarTask | null>(null);
  const [cell, setCell] = useState<CellTasks | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const openTask = (task: CalendarTask, label: string) => {
    setCell(null);
    if (isStand) {
      setPreview(label);
    } else if (task.status === 'done') {
      setReading(task);
    } else {
      setEditing({ task });
    }
  };

  const newTask = () => {
    if (isStand) {
      setPreview(t('panel.tasks.actions.new'));
    } else {
      setEditing({ task: null });
    }
  };

  const newTaskOn = (propertyId: number, place: string, day: string) => {
    if (isStand) {
      setPreview(t('panel.calendar.stand.newTask', { place, day: formatDay(day, language) }));
    } else {
      setEditing({ task: null, start: { propertyId, scheduledDate: day } });
    }
  };

  const showCell = (rowId: number, place: string, day: string, tasks: readonly CalendarTask[]) =>
    setCell({ rowId, place, day, tasks });

  const dialogs = (
    <>
      {editing === null ? null : (
        <TaskForm task={editing.task} initial={editing.start} onClose={() => setEditing(null)} />
      )}
      {reading === null ? null : <TaskDrawer task={reading} onClose={() => setReading(null)} />}
      <CellTasksDialog
        cell={cell}
        bookings={bookings}
        language={language}
        onOpen={openTask}
        onClose={() => setCell(null)}
      />
      <StandPreview text={preview} onClose={() => setPreview(null)} />
    </>
  );

  return { openTask, newTask, newTaskOn, showCell, dialogs };
}
