'use client';

import Link from 'next/link';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { Language } from '@str-ops/shared';

import { formatClock } from '@/features/tasks/format';
import { isRepairOverdue } from '@/features/tasks/repairs';
import { localizedTitle, type CalendarTask } from '@/features/tasks/schema';
import { cn } from '@/lib/utils';

import {
  chipCapacity,
  chipTone,
  isBookingChanged,
  type BookingsRead,
  type ChipTone,
  type ChipView,
} from './chips';

/** The line of chips under the track of bars (see `row-track.tsx`). */
export const CHIP_TOP = 24;
const CHIP_HEIGHT = 16;
const DOT_SIZE = 7;
const DOT_GAP = 2;
const MORE_WIDTH = 24;

/**
 * A chip's colour by the status filter's group. One place for the three
 * colours until the redesign gives the panel status tokens (ROADMAP 5.2).
 */
const TONE_DOT: Readonly<Record<ChipTone, string>> = {
  open: 'bg-sky-600',
  inWork: 'bg-amber-500',
  done: 'bg-emerald-600',
};

/**
 * A status's dot. What never happened and the cancelled differ by shape as
 * well as colour (§4): a hollow red ring, a grey square.
 */
function dotClass(task: CalendarTask, isOverdue: boolean): string {
  if (task.status === 'expired') {
    return 'rounded-full border-2 border-destructive bg-transparent';
  }
  if (task.status === 'cancelled') {
    return 'rounded-none bg-muted-foreground/50';
  }
  const tone = chipTone(task.status);
  // An overdue repair's dot is a framed square: not only red (§6).
  return cn(
    isOverdue ? 'rounded-sm border-2 border-destructive' : 'rounded-full',
    tone === null ? 'bg-muted-foreground' : TONE_DOT[tone],
  );
}

/** Hatched, not only red: «Не состоялась» must read without colour (§2). */
const HATCH_RED =
  'repeating-linear-gradient(135deg, transparent 0 3px, rgb(220 38 38 / 0.18) 3px 6px)';

/** A full chip's frame: what never happened, the cancelled, an overdue repair. */
function chipClass(task: CalendarTask, isOverdue: boolean): string {
  if (task.status === 'expired') {
    return 'border-destructive text-destructive';
  }
  if (task.status === 'cancelled') {
    return 'text-muted-foreground line-through opacity-70';
  }
  return isOverdue ? 'border-destructive' : '';
}

export interface ChipText {
  /** Everything the chip knows, for a screen reader and a tooltip (§4). */
  label: string;
  /** What the chip shows first: the problem of a repair, else the person. */
  lead: string;
  /** Who does it, or «Никто»: all a compact chip shows beside its dot. */
  person: string;
  isNobody: boolean;
  window: string | null;
  isSdt: boolean;
  /** A live repair past its day, by the listing's own today (§6). */
  isOverdue: boolean;
}

/**
 * The words of a chip, in the manager's language. `rowId` is the row the chip
 * is drawn on: a closed group folds its rooms' chips into the listing's row
 * (§3), and there a chip names the room it stands on.
 */
export function useChipText(language: Language) {
  const { t } = useTranslation();

  return (task: CalendarTask, isChanged: boolean, rowId: number): ChipText => {
    const name =
      task.problem?.title ?? localizedTitle(task, language) ?? t(`panel.tasks.types.${task.type}`);
    const place =
      task.property_id === rowId ? null : (task.property?.name ?? String(task.property_id));
    const isNobody = task.assignee_id === null;
    const person = isNobody
      ? t('panel.calendar.nobody')
      : (task.assignee?.full_name ?? t('panel.apartments.bookings.noName'));
    const window =
      task.time_from !== null && task.time_to !== null
        ? `${formatClock(task.time_from)}–${formatClock(task.time_to)}`
        : task.time_from !== null
          ? t('panel.tasks.window.from', { time: formatClock(task.time_from) })
          : task.time_to !== null
            ? t('panel.tasks.window.until', { time: formatClock(task.time_to) })
            : null;
    // SDT: the next guest arrives the same day, into the same room (§4).
    const isSdt = task.type === 'cleaning' && task.priority === 1;
    const isOverdue = task.problem_id !== null && isRepairOverdue(task);
    // «Просрочена» already names the status and the overdue badge of the
    // Cleanings screen; the calendar's legend needs both words apart (§2).
    const status =
      task.status === 'expired'
        ? t('panel.calendar.expiredMark')
        : t(`panel.tasks.statuses.${task.status}`);
    const label = [
      place,
      name,
      status,
      person,
      window,
      isSdt ? `${t('panel.calendar.sdtMark')} (${t('panel.calendar.sdt')})` : null,
      task.problem?.priority === 'high' ? t('problems.priorities.high') : null,
      isOverdue ? t('panel.calendar.overdue') : null,
      isChanged ? t('panel.calendar.bookingChanged') : null,
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(', ');
    const lead = [
      place,
      task.status === 'expired' ? status : null,
      isOverdue ? t('panel.calendar.overdue') : null,
      task.problem?.title ?? null,
      person,
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
    return { label, lead, person, isNobody, window, isSdt, isOverdue };
  };
}

interface ChipLinkOrButtonProps {
  task: CalendarTask;
  label: string;
  className: string;
  style: CSSProperties;
  onOpen: (task: CalendarTask, label: string) => void;
  children?: ReactNode;
}

/** A repair leads to its problem, where its day and technician change (§6). */
function ChipLinkOrButton({
  task,
  label,
  className,
  style,
  onOpen,
  children,
}: ChipLinkOrButtonProps) {
  if (task.problem_id !== null) {
    return (
      <Link
        href={`/problems/${task.problem_id}`}
        aria-label={label}
        title={label}
        className={className}
        style={style}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={className}
      style={style}
      onClick={() => onOpen(task, label)}
    >
      {children}
    </button>
  );
}

interface TaskChipsProps {
  /** The row the chips are drawn on. */
  rowId: number;
  /** The tasks of each day of the window, in window order. */
  cells: readonly (readonly CalendarTask[])[];
  days: readonly string[];
  dayWidth: number;
  /** The bookings read for the window's months; null until they are read. */
  bookings: BookingsRead | null;
  /** In full, or compact: the status dot and the person alone. */
  view: ChipView;
  language: Language;
  onOpen: (task: CalendarTask, label: string) => void;
  onMore: (day: string, tasks: readonly CalendarTask[]) => void;
}

/**
 * The chips of one row (docs/f10-plan.md, 7.4, §4): a week reads a chip in
 * full, thirty days a dot; what does not fit is «+N», which lists them all.
 * Compact, a chip is its dot and its person, and the rest — the window, SDT,
 * the type — is in its tooltip and label.
 */
export function TaskChips({
  rowId,
  cells,
  days,
  dayWidth,
  bookings,
  view,
  language,
  onOpen,
  onMore,
}: TaskChipsProps) {
  const { t } = useTranslation();
  const textOf = useChipText(language);
  const capacity = chipCapacity(dayWidth, view);

  return days.map((day, at) => {
    const tasks = cells[at] ?? [];
    if (tasks.length === 0) {
      return null;
    }
    const shown = tasks.slice(0, capacity.count);
    const rest = tasks.length - shown.length;
    const cellLeft = at * dayWidth;
    // After the dots, «+N» takes what is left of the cell and no more: at
    // thirty days a wider one lay over the next day's first dot.
    const dotsEnd = DOT_GAP + shown.length * (DOT_SIZE + DOT_GAP);
    const more =
      rest === 0 ? null : (
        <button
          type="button"
          title={t('panel.calendar.moreTasks', { count: rest })}
          className={cn(
            'absolute overflow-hidden rounded text-center leading-none whitespace-nowrap text-muted-foreground hover:bg-accent',
            capacity.mode === 'dot' ? 'text-[9px]' : 'px-0.5 text-[10px]',
          )}
          style={
            capacity.mode === 'dot'
              ? {
                  left: cellLeft + dotsEnd,
                  width: dayWidth - dotsEnd - 1,
                  top: CHIP_TOP,
                  height: CHIP_HEIGHT,
                }
              : { left: cellLeft + dayWidth - MORE_WIDTH, top: CHIP_TOP, height: CHIP_HEIGHT }
          }
          onClick={() => onMore(day, tasks)}
        >
          {`+${rest}`}
        </button>
      );

    if (capacity.mode === 'dot') {
      return (
        <Fragment key={day}>
          {shown.map((task, k) => {
            const isChanged = isBookingChanged(task, bookings);
            const text = textOf(task, isChanged, rowId);
            return (
              <ChipLinkOrButton
                key={task.id}
                task={task}
                label={text.label}
                onOpen={onOpen}
                className={cn(
                  'absolute',
                  dotClass(task, text.isOverdue),
                  isChanged && 'ring-2 ring-amber-500',
                )}
                style={{
                  left: cellLeft + DOT_GAP + k * (DOT_SIZE + DOT_GAP),
                  top: CHIP_TOP + (CHIP_HEIGHT - DOT_SIZE) / 2,
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                }}
              />
            );
          })}
          {more}
        </Fragment>
      );
    }

    const slot = (dayWidth - 4 - (rest > 0 ? MORE_WIDTH : 0)) / shown.length;
    return (
      <Fragment key={day}>
        {shown.map((task, k) => {
          const isChanged = isBookingChanged(task, bookings);
          const text = textOf(task, isChanged, rowId);
          return (
            <ChipLinkOrButton
              key={task.id}
              task={task}
              label={text.label}
              onOpen={onOpen}
              className={cn(
                'absolute flex items-center gap-1 overflow-hidden rounded-sm border bg-background px-1 text-[10px] leading-none whitespace-nowrap hover:bg-accent',
                chipClass(task, text.isOverdue),
                isChanged && 'ring-2 ring-amber-500',
              )}
              style={{
                left: cellLeft + 2 + k * slot,
                width: slot - 2,
                top: CHIP_TOP,
                height: CHIP_HEIGHT,
                backgroundImage: task.status === 'expired' ? HATCH_RED : undefined,
              }}
            >
              <span aria-hidden className={cn('size-2 shrink-0', dotClass(task, false))} />
              {capacity.mode === 'compact' ? (
                <span className={cn('truncate', text.isNobody && 'text-destructive')}>
                  {text.person}
                </span>
              ) : (
                <>
                  <span className={cn('truncate', text.isNobody && 'text-destructive')}>
                    {text.lead}
                  </span>
                  {text.window === null ? null : (
                    <span className="shrink-0 text-muted-foreground">{text.window}</span>
                  )}
                  {text.isSdt ? (
                    <span className="shrink-0 rounded-sm bg-orange-500 px-0.5 text-[9px] text-white">
                      {t('panel.calendar.sdtMark')}
                    </span>
                  ) : null}
                  {isChanged ? <span aria-hidden>⚠</span> : null}
                </>
              )}
            </ChipLinkOrButton>
          );
        })}
        {more}
      </Fragment>
    );
  });
}
