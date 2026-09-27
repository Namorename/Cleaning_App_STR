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
import type { CalendarTask } from '@/features/tasks/schema';
import { formatDay } from '@/lib/format-date';

import { isBookingChanged, type BookingsRead } from './chips';
import { useChipText } from './task-chips';

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
  onOpen: (task: CalendarTask, label: string) => void;
  onClose: () => void;
}

/**
 * Every task of a cell, behind its «+N» (docs/f10-plan.md, §4): a chip that
 * does not fit is still one click away, and its words are all there.
 */
export function CellTasksDialog({
  cell,
  bookings,
  language,
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
        <CellTasksList cell={cell} bookings={bookings} language={language} onOpen={onOpen} />
      )}
    </Dialog>
  );
}

interface CellTasksListProps {
  cell: CellTasks;
  bookings: BookingsRead | null;
  language: Language;
  onOpen: (task: CalendarTask, label: string) => void;
}

function CellTasksList({ cell, bookings, language, onOpen }: CellTasksListProps) {
  const textOf = useChipText(language);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{cell.place}</DialogTitle>
        <DialogDescription>{formatDay(cell.day, language)}</DialogDescription>
      </DialogHeader>
      <ul className="flex flex-col gap-1">
        {cell.tasks.map((task) => {
          const { label } = textOf(task, isBookingChanged(task, bookings), cell.rowId);
          return (
            <li key={task.id}>
              {task.problem_id === null ? (
                <button
                  type="button"
                  className="w-full rounded-md border px-2 py-1 text-left text-sm hover:bg-accent"
                  onClick={() => onOpen(task, label)}
                >
                  {label}
                </button>
              ) : (
                <Link
                  href={`/problems/${task.problem_id}`}
                  className="block rounded-md border px-2 py-1 text-sm hover:bg-accent"
                >
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
