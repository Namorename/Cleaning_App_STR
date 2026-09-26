'use client';

import { useTranslation } from 'react-i18next';

import type { Language } from '@str-ops/shared';

import { formatShortDay } from '@/lib/format-date';
import { cn } from '@/lib/utils';

import type { CalendarTask } from '@/features/tasks/schema';

import type { Bar, RowLayout, Shadow } from './bars';
import type { ChipView } from './chips';
import type { CalendarBooking } from './schema';
import { TaskChips } from './task-chips';

/** The track of bars at the top of a row; the chips take the line under it. */
const BAR_TOP = 4;
const BAR_HEIGHT = 18;
/** A block is hatched, not only greyed: it must read without colour. */
const HATCH = 'repeating-linear-gradient(135deg, transparent 0 4px, rgb(0 0 0 / 0.14) 4px 8px)';

interface RowTrackProps {
  /** The property the row stands for. */
  rowId: number;
  layout: RowLayout | undefined;
  /** The chips of each day of the window, the group's folded in when it is closed. */
  cells: readonly (readonly CalendarTask[])[];
  /** The window's bookings by id, for the «booking changed» warning; null until read. */
  bookings: ReadonlyMap<number, CalendarBooking> | null;
  days: readonly string[];
  dayWidth: number;
  /** The day lines, drawn as a background rather than a box per cell (§4). */
  dayLines: string;
  /** A closed group shows how many of its units are taken instead of bars (§3). */
  isClosedGroup: boolean;
  unitCount: number;
  highlighted: number | null;
  chipView: ChipView;
  language: Language;
  onPoint: (bookingId: number | null) => void;
  onOpen: (booking: CalendarBooking) => void;
  onOpenTask: (task: CalendarTask, label: string) => void;
  onMoreTasks: (day: string, tasks: readonly CalendarTask[]) => void;
  /** A press on the empty part of a day: a new task there. */
  onEmptyDay: (day: string) => void;
}

/**
 * The days of one row: shades, then bars on top, or a closed group's counts;
 * the chips on the line under them.
 */
export function RowTrack({
  rowId,
  layout,
  cells,
  bookings,
  days,
  dayWidth,
  dayLines,
  isClosedGroup,
  unitCount,
  highlighted,
  chipView,
  language,
  onPoint,
  onOpen,
  onOpenTask,
  onMoreTasks,
  onEmptyDay,
}: RowTrackProps) {
  // A bar, a chip or «+N» answer for themselves; the rest of the day is empty.
  // The keyboard's way to a new task is the «Новое задание» button.
  const pressEmpty = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a') !== null) {
      return;
    }
    const at = Math.floor(
      (event.clientX - event.currentTarget.getBoundingClientRect().left) / dayWidth,
    );
    if (at >= 0 && at < days.length) {
      onEmptyDay(days[at]);
    }
  };

  return (
    <div
      role="gridcell"
      aria-colspan={days.length}
      className="relative h-full"
      style={{ width: days.length * dayWidth, backgroundImage: dayLines }}
      onClick={pressEmpty}
    >
      {layout === undefined ? null : isClosedGroup ? (
        <Occupancy days={days} counts={layout.occupancy} total={unitCount} dayWidth={dayWidth} />
      ) : (
        <>
          {layout.shadows.map((shadow) => (
            <ShadowBand
              key={`${shadow.bookingId}-${shadow.part ?? ''}`}
              shadow={shadow}
              dayWidth={dayWidth}
            />
          ))}
          {layout.bars.map((bar) => (
            <BarButton
              key={bar.booking.id}
              bar={bar}
              dayWidth={dayWidth}
              isHighlighted={highlighted === bar.booking.id}
              language={language}
              onPoint={onPoint}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
      {/* Last, so a shade — the full height of the row — never lies over a chip. */}
      <TaskChips
        rowId={rowId}
        cells={cells}
        days={days}
        dayWidth={dayWidth}
        bookings={bookings}
        view={chipView}
        language={language}
        onOpen={onOpenTask}
        onMore={onMoreTasks}
      />
    </div>
  );
}

interface BarButtonProps {
  bar: Bar;
  dayWidth: number;
  isHighlighted: boolean;
  language: Language;
  onPoint: (bookingId: number | null) => void;
  onOpen: (booking: CalendarBooking) => void;
}

function BarButton({ bar, dayWidth, isHighlighted, language, onPoint, onOpen }: BarButtonProps) {
  const { t } = useTranslation();
  const { booking } = bar;
  const isDouble = bar.lanes > 1;
  // A "#" booking is the office's own work: the bar says "block", and its
  // name is read in the card.
  const name =
    bar.kind === 'block'
      ? t('panel.apartments.bookings.block')
      : (booking.guest_name ?? t('panel.apartments.bookings.noName'));
  const label = [
    name,
    `${formatShortDay(booking.arrival_date, language)}–${formatShortDay(booking.departure_date, language)}`,
    isDouble ? t('panel.calendar.doubleBooking') : null,
    bar.cutStart ? t('panel.calendar.continuesBefore') : null,
    bar.cutEnd ? t('panel.calendar.continuesAfter') : null,
  ]
    .filter((part) => part !== null)
    .join(', ');
  const height = BAR_HEIGHT / bar.lanes;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-highlighted={isHighlighted ? 'true' : undefined}
      className={cn(
        'absolute flex items-center gap-0.5 overflow-hidden rounded-sm px-1 text-left text-[11px] leading-none whitespace-nowrap',
        bar.kind === 'guest'
          ? 'bg-primary text-primary-foreground'
          : 'border bg-muted text-muted-foreground',
        bar.cutStart && 'rounded-l-none',
        bar.cutEnd && 'rounded-r-none',
        isDouble && 'ring-2 ring-destructive',
        isHighlighted && 'outline-2 outline-offset-1 outline-ring',
      )}
      style={{
        left: bar.from * dayWidth,
        width: (bar.to - bar.from) * dayWidth,
        top: BAR_TOP + bar.lane * height,
        height,
        backgroundImage: bar.kind === 'block' ? HATCH : undefined,
      }}
      onMouseEnter={() => onPoint(booking.id)}
      onMouseLeave={() => onPoint(null)}
      onFocus={() => onPoint(booking.id)}
      onBlur={() => onPoint(null)}
      onClick={() => onOpen(booking)}
    >
      {bar.cutStart ? <span aria-hidden>‹</span> : null}
      {isDouble ? <span aria-hidden>⚠</span> : null}
      <span className="truncate">{name}</span>
      {bar.cutEnd ? (
        <span aria-hidden className="ml-auto">
          ›
        </span>
      ) : null}
    </button>
  );
}

function ShadowBand({ shadow, dayWidth }: { shadow: Shadow; dayWidth: number }) {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden
      title={
        shadow.part === null
          ? t('panel.calendar.shadowWhole')
          : t('panel.calendar.shadowPart', { name: shadow.part })
      }
      className="absolute inset-y-0 bg-foreground/10"
      style={{ left: shadow.from * dayWidth, width: (shadow.to - shadow.from) * dayWidth }}
    />
  );
}

interface OccupancyProps {
  days: readonly string[];
  counts: readonly number[];
  total: number;
  dayWidth: number;
}

function Occupancy({ days, counts, total, dayWidth }: OccupancyProps) {
  const { t } = useTranslation();
  return days.map((day, at) => {
    const taken = counts[at] ?? 0;
    return taken === 0 ? null : (
      <span
        key={day}
        title={t('panel.calendar.occupancy', { taken, total })}
        className="absolute flex items-center justify-center text-xs text-muted-foreground"
        // On the bars' line: the folded chips take the line under it.
        style={{ left: at * dayWidth, width: dayWidth, top: BAR_TOP, height: BAR_HEIGHT }}
      >
        {`${taken}/${total}`}
      </span>
    );
  });
}
