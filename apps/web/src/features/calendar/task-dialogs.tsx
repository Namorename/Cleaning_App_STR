'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@str-ops/shared';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChatSheet } from '@/features/chat/chat-sheet';
import {
  isTaskClosed,
  type CalendarTask,
  type Task,
  type TaskDraft,
} from '@/features/tasks/schema';
import { TaskDrawer } from '@/features/tasks/task-drawer';
import { TaskForm } from '@/features/tasks/task-form';
import { taskSummary } from '@/features/tasks/task-row';
import { useTask } from '@/features/tasks/use-tasks';
import { formatDay } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';

import { CellTasksDialog, type CellTasks } from './cell-tasks-dialog';
import type { BookingsRead } from './chips';
import { StandPreview } from './stand-preview';

type Start = Pick<TaskDraft, 'propertyId' | 'scheduledDate'>;

interface TaskDialogsOptions {
  isStand: boolean;
  language: Language;
  bookings: BookingsRead | null;
}

/**
 * What a chip, «+N» and an empty day open (docs/f10-plan.md, 7.4): the task
 * form for an open task or a new one, the drawer for a done one. On the stand
 * writing is off (§5), so each opens a preview card instead. The drawer's
 * «Разговор» swaps it for the conversation's sheet (5.4, «Чат»): one sheet
 * at a time.
 */
export function useTaskDialogs({ isStand, language, bookings }: TaskDialogsOptions) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<{ task: CalendarTask | null; start?: Start } | null>(null);
  const [reading, setReading] = useState<CalendarTask | null>(null);
  // A mark of what never happened is read narrow (§1): its drawer reads it whole.
  const [lapsedId, setLapsedId] = useState<string | null>(null);
  const [cell, setCell] = useState<CellTasks | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [talking, setTalking] = useState<Task | null>(null);

  const openChat = (task: Task) => {
    setReading(null);
    setLapsedId(null);
    setTalking(task);
  };

  const openTask = (task: CalendarTask, label: string) => {
    setCell(null);
    if (isStand) {
      setPreview(label);
    } else if (task.status === 'expired') {
      setLapsedId(task.id);
    } else if (isTaskClosed(task)) {
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
      {reading === null ? null : (
        <TaskDrawer task={reading} onClose={() => setReading(null)} onOpenChat={openChat} />
      )}
      {lapsedId === null ? null : (
        <WholeTaskDrawer
          taskId={lapsedId}
          onClose={() => setLapsedId(null)}
          onOpenChat={openChat}
        />
      )}
      {talking === null ? null : (
        <ChatSheet
          subject={{ taskId: talking.id }}
          about={taskSummary(talking, language, t)}
          onClose={() => setTalking(null)}
        />
      )}
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

interface WholeTaskDrawerProps {
  taskId: string;
  onClose: () => void;
  onOpenChat: (task: Task) => void;
}

/**
 * The drawer of a task the calendar holds only narrow (§1): it reads the
 * task whole first. Until then a card says it is reading; a read that fails,
 * or a task no longer there to see, says so in that card rather than
 * opening an empty drawer.
 */
function WholeTaskDrawer({ taskId, onClose, onOpenChat }: WholeTaskDrawerProps) {
  const { t } = useTranslation();
  const task = useTask(taskId);

  if (task.data !== undefined && task.data !== null) {
    return <TaskDrawer task={task.data} onClose={onClose} onOpenChat={onOpenChat} />;
  }
  const isMissing = task.isError || task.data === null;
  const failure = task.isError ? serverErrorText(task.error) : null;
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isMissing ? t('panel.calendar.taskMissing') : t('panel.tasks.loading')}
          </DialogTitle>
          <DialogDescription>{failure?.detail ?? ''}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
