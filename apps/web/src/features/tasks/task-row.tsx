'use client';

import { STATUS_TONE, taskStatusTone, type Language } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import { UnreadChatButton } from '@/features/chat/unread-mark';
import { formatShortDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { formatWindow } from './format';
import { TaskNote } from './task-note';
import {
  isManualTask,
  isTaskClosed,
  isTechnicianJob,
  localizedTitle,
  tailOf,
  taskPropertyName,
  type Task,
  type TaskTail,
} from './schema';

/** The columns of a row, in order; the table's head names them, a group heading spans them. */
export const TASK_COLUMNS = [
  'window',
  'property',
  'type',
  'title',
  'status',
  'assignee',
  'marks',
  'actions',
] as const;

/**
 * The words on a task left behind its day: "since yesterday · check-out
 * 22.09" for a one-day tail, "Overdue · check-out 21.09" for an older one;
 * a task that is not from a booking names just the day.
 */
function tailLabel(task: Task, tail: TaskTail, language: Language, t: TFunction): string {
  const lead = tail.days === 1 ? t('panel.tasks.tail.yesterday') : t('panel.tasks.overdue');
  const day = formatShortDay(task.scheduled_date, language);
  const detail =
    task.reservation_id === null ? day : t('panel.tasks.tail.departure', { date: day });
  return `${lead} · ${detail}`;
}

/**
 * The row in a few words — its own name or its kind, and the flat: what the
 * row's menu is named after, and what the question before a cancel repeats.
 */
export function taskSummary(task: Task, language: Language, t: TFunction): string {
  const name = localizedTitle(task, language) ?? t(`panel.tasks.types.${task.type}`);
  return `${name} · ${taskPropertyName(task) ?? t('panel.tasks.noProperty')}`;
}

/** The cells that only say something: a dash on screen, the words for a screen reader. */
function Nothing({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

interface TaskRowProps {
  task: Task;
  /** The instant the list was drawn at, so a whole list agrees on what a tail is. */
  now: Date;
  onEdit: (task: Task) => void;
  /** The drawer of the work: offered once the job has been started. */
  onOpenWork: (task: Task) => void;
  /** The conversation about the job, in its sheet: offered on every row. */
  onOpenChat: (task: Task) => void;
  /** Ask whether to call the job off; the view asks, and owns the write. */
  onCancel: (task: Task) => void;
  /** Somebody said something in the conversation about this job that the manager has not read. */
  hasUnread?: boolean;
}

/** What the drawer of a started job shows, said as the item that opens it. */
function workItemKey(task: Task): string {
  if (task.status === 'done') {
    return isTechnicianJob(task)
      ? 'panel.tasks.actions.openRepairWork'
      : 'panel.tasks.actions.openWork';
  }
  return isTechnicianJob(task)
    ? 'panel.tasks.actions.openRepairWorkLive'
    : 'panel.tasks.actions.openWorkLive';
}

/**
 * One job as one line of the table (5.4, variant A): when, where, what, its
 * state and who holds it, what stands out about it, and its menu.
 *
 * Every action is in the menu «⋯», the one target of the row, 44 px square —
 * which is what keeps the row itself about 45 px high. A row names its kind
 * once: the name column holds a name of its own or nothing, and «nobody» is
 * said by the status, the executor column stays a dash.
 */
export function TaskRow({
  task,
  now,
  onEdit,
  onOpenWork,
  onOpenChat,
  onCancel,
  hasUnread = false,
}: TaskRowProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  const timeWindow = formatWindow(task.time_from, task.time_to, {
    from: (time) => t('panel.tasks.window.from', { time }),
    until: (time) => t('panel.tasks.window.until', { time }),
  });
  const closed = isTaskClosed(task);
  // A live task left behind its day is labelled in words and striped in the
  // overdue tone, not marked by colour alone.
  const tail = tailOf(task, now);
  const canCancel = !closed && isManualTask(task);

  return (
    <TableRow data-tail={tail === null ? undefined : ''}>
      <TableCell
        className={cn(
          'py-1 tabular-nums',
          tail === null ? null : 'border-l-[3px] border-tone-overdue-mark',
        )}
      >
        {timeWindow ?? <Nothing label={t('panel.tasks.groups.anytime')} />}
      </TableCell>
      <TableCell className="py-1">
        {taskPropertyName(task) ?? t('panel.tasks.noProperty')}
      </TableCell>
      <TableCell className="py-1 text-muted-foreground">
        {t(`panel.tasks.types.${task.type}`)}
      </TableCell>
      <TableCell className="max-w-64 min-w-32 py-0 font-medium whitespace-normal">
        <div className="flex min-h-11 items-center gap-1">
          {localizedTitle(task, language)}
          {task.notes === null || task.notes.trim() === '' ? null : <TaskNote note={task.notes} />}
        </div>
      </TableCell>
      <TableCell className="py-1">
        <Badge tone={taskStatusTone(task.status)}>{t(`panel.tasks.statuses.${task.status}`)}</Badge>
      </TableCell>
      <TableCell className="py-1">
        {task.assignee?.full_name == null ? (
          <Nothing label={t('panel.tasks.noAssignee')} />
        ) : (
          <Person name={task.assignee.full_name} role={task.assignee.role} />
        )}
      </TableCell>
      <TableCell className="py-1">
        <TaskMarks
          task={task}
          tail={tail}
          hasUnread={hasUnread}
          onOpenChat={() => onOpenChat(task)}
        />
      </TableCell>
      <TableCell className="py-0 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger
            // Where the conversation hands the focus back: its menu is gone by then.
            data-task-menu={task.id}
            render={<Button type="button" variant="ghost" className="size-11" />}
            aria-label={t('panel.tasks.actions.menu', { name: taskSummary(task, language, t) })}
          >
            <Ellipsis aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {closed ? null : (
              <DropdownMenuItem onClick={() => onEdit(task)}>
                {t('panel.tasks.actions.edit')}
              </DropdownMenuItem>
            )}
            {/* The drawer is the work's: there is some once the job has been
                started, and the item is named after what it will show. The
                conversation has its own sheet («Чат», variant B), every job. */}
            {task.started_at === null ? null : (
              <DropdownMenuItem onClick={() => onOpenWork(task)}>
                {t(workItemKey(task))}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onOpenChat(task)}>
              {t('panel.chat.open')}
            </DropdownMenuItem>
            {canCancel ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onCancel(task)}>
                  {t('panel.tasks.actions.cancel')}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

interface TaskMarksProps {
  task: Task;
  tail: TaskTail | null;
  hasUnread: boolean;
  onOpenChat: () => void;
}

/**
 * What stands out about a job: left behind, written about — then, quietly,
 * where it came from. «Новое сообщение» opens the conversation it is about.
 */
function TaskMarks({ task, tail, hasUnread, onOpenChat }: TaskMarksProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <div className="flex items-center gap-1.5">
      {tail === null ? null : (
        <Badge tone={STATUS_TONE['tasks.tail']}>{tailLabel(task, tail, language, t)}</Badge>
      )}
      {hasUnread ? (
        <UnreadChatButton onOpen={onOpenChat} about={taskSummary(task, language, t)} />
      ) : null}
      <span className="text-xs text-muted-foreground">
        {task.reservation_id !== null ? t('panel.tasks.origin.booking') : null}
        {task.problem_id !== null ? t('panel.tasks.origin.problem') : null}
      </span>
      {task.author?.full_name == null ? null : (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {t('panel.tasks.authorLabel')}
          <Person name={task.author.full_name} role={task.author.role} />
        </span>
      )}
    </div>
  );
}
