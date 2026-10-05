'use client';

import Link from 'next/link';

import type { Language } from '@str-ops/shared';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { NO_UNREAD, type UnreadSubjects } from '@/features/chat/schema';
import type { CalendarTask } from '@/features/tasks/schema';
import { formatDay } from '@/lib/format-date';

import { isBookingChanged, type BookingsRead } from './chips';
import { UnreadGlyph, useChipText } from './task-chips';

export interface CellTasks {
  /** The row the cell is on: a folded group's tasks name their room. */
  rowId: number;
  day: string;
  place: string;
  tasks: readonly CalendarTask[];
}

interface CellTasksDialogProps {
  cell: CellTasks | null;
  bookings: BookingsRead | null;
  language: Language;
  /** The jobs and tasks somebody wrote about that the manager has not read. */
  unread?: UnreadSubjects;
  onOpen: (task: CalendarTask, label: string) => void;
  onClose: () => void;
}

/**
 * Every task of a cell, behind its «+N» (docs/f10-plan.md, §4): a chip that
 * does not fit is still one click away, and its words are all there — an
 * unread message's among them, with its picture (5.4, «Чат»).
 */
export function CellTasksDialog({
  cell,
  bookings,
  language,
  unread = NO_UNREAD,
  onOpen,
  onClose,
}: CellTasksDialogProps) {
  return (
    <Dialog
      open={cell !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      {cell === null ? null : (
        <CellTasksList
          cell={cell}
          bookings={bookings}
          language={language}
          unread={unread}
          onOpen={onOpen}
        />
      )}
    </Dialog>
  );
}

interface CellTasksListProps {
  cell: CellTasks;
  bookings: BookingsRead | null;
  language: Language;
  unread: UnreadSubjects;
  onOpen: (task: CalendarTask, label: string) => void;
}

function CellTasksList({ cell, bookings, language, unread, onOpen }: CellTasksListProps) {
  const textOf = useChipText(language, unread);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{cell.place}</DialogTitle>
        <DialogDescription>{formatDay(cell.day, language)}</DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-1">
        {cell.tasks.map((task) => {
          const { label, hasUnread } = textOf(task, isBookingChanged(task, bookings), cell.rowId);
          const glyph = hasUnread ? <UnreadGlyph /> : null;
          return (
            <li key={task.id}>
              {task.problem_id === null ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => onOpen(task, label)}
                >
                  {glyph}
                  {label}
                </button>
              ) : (
                <Link
                  href={`/problems/${task.problem_id}`}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:bg-accent"
                >
                  {glyph}
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </DialogContent>
  );
}
