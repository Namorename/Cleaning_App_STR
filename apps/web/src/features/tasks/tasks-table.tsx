'use client';

import { useTranslation } from 'react-i18next';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { Task, TaskGroup } from './schema';
import { TASK_COLUMNS, TaskRow } from './task-row';

interface TasksTableProps {
  groups: TaskGroup[];
  /** The instant the list was drawn at, so every row agrees on what a tail is. */
  now: Date;
  /** The jobs somebody wrote about that the manager has not read. */
  unread: ReadonlySet<string>;
  onEdit: (task: Task) => void;
  onOpenWork: (task: Task) => void;
  onOpenChat: (task: Task) => void;
  onCancel: (task: Task) => void;
}

/**
 * One tab of «Уборки» as a dense table (5.4, variant A): one head for the
 * columns, then each group — a part of the day on «Сегодня», a day on the
 * other tabs — under a heading that spans the row. Some fifteen to twenty
 * jobs to a screen instead of five cards.
 *
 * The table scrolls sideways inside its own frame: on a phone the page itself
 * never does (decision 14).
 */
export function TasksTable({
  groups,
  now,
  unread,
  onEdit,
  onOpenWork,
  onOpenChat,
  onCancel,
}: TasksTableProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {TASK_COLUMNS.map((column) => (
              <TableHead
                key={column}
                className={
                  column === 'actions' ? 'w-11 text-muted-foreground' : 'text-muted-foreground'
                }
              >
                <span className={column === 'actions' ? 'sr-only' : undefined}>
                  {t(`panel.tasks.columns.${column}`)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {groups.map((group) => (
          <TableBody key={group.key}>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={TASK_COLUMNS.length} className="bg-muted/50 py-1.5">
                <h2 className="text-sm font-semibold text-muted-foreground">
                  {group.kind === 'day'
                    ? formatDay(group.key, language)
                    : t(`panel.tasks.groups.${group.key}`)}
                </h2>
              </TableCell>
            </TableRow>
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                now={now}
                onEdit={onEdit}
                onOpenWork={onOpenWork}
                onOpenChat={onOpenChat}
                onCancel={onCancel}
                hasUnread={unread.has(task.id)}
              />
            ))}
          </TableBody>
        ))}
      </Table>
    </div>
  );
}
