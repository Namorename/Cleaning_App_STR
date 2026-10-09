'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { propertyPath, STATUS_TONE, type Language } from '@str-ops/shared';

import { Badge } from '@/components/ui/badge';
import type { UnreadSubjects } from '@/features/chat/schema';
import { mergeRepairAlerts, type RepairAlert } from '@/features/tasks/repairs';
import type { CalendarTask, Property } from '@/features/tasks/schema';
import { formatShortDay } from '@/lib/format-date';
import type { VisibleRow } from '@/lib/property-tree';

import type { RowLayout } from './bars';
import { cellTasks, type BookingsRead, type ChipView } from './chips';
import { dayLabel, dayWidthFor, fullDayLabel, type Depth } from './dates';
import { shiftedScroll, useLeftEdge } from './left-edge';
import { RowTrack } from './row-track';
import type { CalendarBooking } from './schema';

/** The property column; the days start after it. */
const FIRST_COLUMN = 240;
const HEADER_HEIGHT = 40;
/**
 * A row's height does not depend on the data of the window (§4): one track of
 * bars and one line of chips, a constant per kind of row. Otherwise rows would
 * jump under the cursor on every arrow and every month read. A room is as tall
 * as a listing: its cleanings are its own, and their line needs the room.
 */
const LISTING_HEIGHT = 44;
const ROOM_HEIGHT = 44;
const INDENT = 16;

interface CalendarGridProps {
  rows: readonly VisibleRow<Property>[];
  /** Every row, for naming a room's house. */
  all: readonly Property[];
  days: readonly string[];
  depth: Depth;
  today: string;
  locale: string;
  collapsed: ReadonlySet<number>;
  onToggleGroup: (id: number) => void;
  /** Bars, shades and counts by property id; empty while bookings load. */
  layout: ReadonlyMap<number, RowLayout>;
  /** The filtered tasks by row and day; empty while tasks load. */
  byRowDay: ReadonlyMap<number, ReadonlyMap<string, readonly CalendarTask[]>>;
  /** The bookings read for the window's months; null until they are read. */
  bookings: BookingsRead | null;
  /** How the chips read: in full, or the status dot and the person. */
  chipView: ChipView;
  language: Language;
  /** The jobs and tasks somebody wrote about that the manager has not read (5.4, «Чат»). */
  unread?: UnreadSubjects;
  onOpenBooking: (booking: CalendarBooking) => void;
  onOpenTask: (task: CalendarTask, label: string) => void;
  onMoreTasks: (rowId: number, place: string, day: string, tasks: readonly CalendarTask[]) => void;
  onEmptyDay: (propertyId: number, place: string, day: string) => void;
  /** Overdue live repairs by property id: a badge in the row's first column (§6). */
  repairAlerts: ReadonlyMap<number, RepairAlert>;
  /** Rows drawn beyond the window; the stand measures «all» too (7.6). */
  overscan: number;
  /** The days were scrolled to their start: the past is asked for (block 7). */
  onReachStart?: () => void;
}

/**
 * The width inside an element's borders and scrollbar, followed as it
 * resizes: the window, the sidebar, a scrollbar coming or going. Zero until
 * measured, and where nothing measures (the server, a test without layout).
 */
function useClientWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

function subtreeIds(node: VisibleRow<Property>['node']): number[] {
  return [node.row.id, ...node.children.flatMap((child) => subtreeIds(child))];
}

interface RepairBadgeProps {
  alert: RepairAlert;
  language: Language;
}

/**
 * A repair left behind (§6): seen whatever the window, even with its day
 * weeks behind it. The overdue tone, the urgent one when a technician on it
 * no longer works here — and says so in words, not only in colour.
 */
function RepairBadge({ alert, language }: RepairBadgeProps) {
  const { t } = useTranslation();
  const who =
    alert.technicians
      .map((person) => {
        const name = person.name ?? t('panel.apartments.bookings.noName');
        return person.isOff ? t('panel.tasks.form.assigneeInactive', { name }) : name;
      })
      .join(', ') || t('panel.calendar.nobody');
  return (
    <Badge
      tone={
        alert.isTechnicianOff
          ? STATUS_TONE['calendar.overdueRepairTechOff']
          : STATUS_TONE['calendar.overdueRepair']
      }
      data-off={alert.isTechnicianOff ? 'true' : undefined}
      title={t('panel.calendar.overdueSince', {
        day: formatShortDay(alert.since, language),
        who,
      })}
      className="shrink-0"
    >
      {t('panel.calendar.overdue')}
    </Badge>
  );
}

interface GridRowProps {
  row: VisibleRow<Property>;
  /** The listing a room belongs to, for its name; undefined for a listing. */
  house: Property | undefined;
  isClosed: boolean;
  layout: RowLayout | undefined;
  byRowDay: CalendarGridProps['byRowDay'];
  repairAlerts: CalendarGridProps['repairAlerts'];
  days: readonly string[];
  dayWidth: number;
  dayLines: string;
  bookings: BookingsRead | null;
  highlighted: number | null;
  chipView: ChipView;
  language: Language;
  unread: CalendarGridProps['unread'];
  onToggleGroup: CalendarGridProps['onToggleGroup'];
  onPoint: (bookingId: number | null) => void;
  onOpenBooking: CalendarGridProps['onOpenBooking'];
  onOpenTask: CalendarGridProps['onOpenTask'];
  onMoreTasks: CalendarGridProps['onMoreTasks'];
  onEmptyDay: CalendarGridProps['onEmptyDay'];
}

/**
 * One row's name and days. A scroll redraws the grid — the virtualizer lives
 * there — but a row already on screen gets the same props and is not drawn
 * again: every one of them is stable while the window scrolls, and what a row
 * derives (its cells, its callbacks) is derived here, not by the grid on every
 * frame (ROADMAP, the 7.6 tail).
 */
const GridRow = memo(function GridRow({
  row,
  house,
  isClosed,
  layout,
  byRowDay,
  repairAlerts,
  days,
  dayWidth,
  dayLines,
  bookings,
  highlighted,
  chipView,
  language,
  unread,
  onToggleGroup,
  onPoint,
  onOpenBooking,
  onOpenTask,
  onMoreTasks,
  onEmptyDay,
}: GridRowProps) {
  const { t } = useTranslation();
  const { node, depth: level } = row;
  const property = node.row;
  const isGroup = node.children.length > 0;
  const place = house === undefined ? property.name : propertyPath(house.name, property.name);
  // A closed group carries its rooms' and parts' badges.
  const alert = mergeRepairAlerts(
    (isGroup && isClosed ? subtreeIds(node) : [property.id]).flatMap((id) => {
      const found = repairAlerts.get(id);
      return found === undefined ? [] : [found];
    }),
  );

  return (
    <>
      <div
        role="rowheader"
        aria-label={place}
        className="sticky left-0 z-10 flex items-center gap-1 border-r bg-background text-sm"
        style={{
          width: FIRST_COLUMN,
          minWidth: FIRST_COLUMN,
          paddingLeft: 8 + level * INDENT,
        }}
      >
        {isGroup ? (
          <button
            type="button"
            className="rounded px-1 text-xs hover:bg-accent"
            aria-expanded={!isClosed}
            aria-label={t(
              isClosed ? 'panel.apartments.tree.expand' : 'panel.apartments.tree.collapse',
              { name: property.name },
            )}
            onClick={() => onToggleGroup(property.id)}
          >
            {isClosed ? '▸' : '▾'}
          </button>
        ) : null}
        <span data-testid="row-name" className="truncate">
          {property.name}
        </span>
        {isGroup ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {t('panel.calendar.units', { count: node.children.length })}
          </span>
        ) : null}
        {property.status === 'maintenance' ? (
          <Badge tone={STATUS_TONE['property.maintenance']} className="shrink-0">
            {t('panel.apartments.tabs.maintenance')}
          </Badge>
        ) : null}
        {alert === undefined ? null : <RepairBadge alert={alert} language={language} />}
      </div>
      <RowTrack
        rowId={property.id}
        layout={layout}
        cells={days.map((day) => cellTasks(node, day, byRowDay, isGroup && isClosed))}
        bookings={bookings}
        days={days}
        dayWidth={dayWidth}
        dayLines={dayLines}
        isClosedGroup={isGroup && isClosed}
        unitCount={node.children.length}
        highlighted={highlighted}
        chipView={chipView}
        language={language}
        unread={unread}
        onPoint={onPoint}
        onOpen={onOpenBooking}
        onOpenTask={onOpenTask}
        onMoreTasks={(day, tasks) => onMoreTasks(property.id, place, day, tasks)}
        onEmptyDay={(day) => onEmptyDay(property.id, place, day)}
      />
    </>
  );
});

/**
 * The grid (docs/f10-plan.md, §4): rows are listings and rooms, columns are
 * days. It is the page's only vertical scroller — the header, the first
 * column and the corner stay put while it scrolls both ways — and only the
 * rows that fit are in the DOM. The day lines are a background, not a block
 * per cell; bars and chips (7.3, 7.4) are placed on top of it.
 */
export function CalendarGrid({
  rows,
  all,
  days,
  depth,
  today,
  locale,
  collapsed,
  onToggleGroup,
  layout,
  byRowDay,
  bookings,
  chipView,
  language,
  unread,
  onOpenBooking,
  onOpenTask,
  onMoreTasks,
  onEmptyDay,
  repairAlerts,
  overscan,
  onReachStart,
}: CalendarGridProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  // Pointing at one bar of a stay of several rooms lights all of them (§3).
  const [highlighted, setHighlighted] = useState<number | null>(null);
  // The days fill the area, never narrower than their depth allows (dates.ts):
  // the depth's days, so the past shown before them scrolls in from the left.
  const dayWidth = dayWidthFor(depth, useClientWidth(scroller) - FIRST_COLUMN);
  const width = FIRST_COLUMN + days.length * dayWidth;
  // The past (block 7): asked for at the left edge, and put in without a jump —
  // the scroll moves before the frame is painted.
  const edge = useLeftEdge(onReachStart);
  const first = days[0];
  const last = days[days.length - 1];
  const shown = useRef({ first, last });
  useLayoutEffect(() => {
    const element = scroller.current;
    const next =
      element === null
        ? null
        : shiftedScroll(shown.current, { first, last }, element.scrollLeft, dayWidth);
    shown.current = { first, last };
    if (element !== null && next !== null) {
      element.scrollLeft = next;
    }
  }, [first, last, dayWidth]);

  // The compiler cannot memoize a component that holds a virtualizer, and
  // should not: the grid redraws on every scroll by design (§4). A row already
  // on screen does not — GridRow gets the same props and is skipped.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (at) => (rows[at].depth === 0 ? LISTING_HEIGHT : ROOM_HEIGHT),
    getItemKey: (at) => rows[at].node.row.id,
    overscan,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });

  const byId = useMemo(() => new Map(all.map((one) => [one.id, one])), [all]);
  const dayLines = `repeating-linear-gradient(to right, transparent 0 ${dayWidth - 1}px, var(--border) ${dayWidth - 1}px ${dayWidth}px)`;

  return (
    <div
      ref={scroller}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-colcount={days.length + 1}
      className="relative min-h-0 flex-1 overflow-auto rounded-md border"
      onScroll={edge.onScroll}
      onWheel={edge.onWheel}
    >
      <div className="relative" style={{ width, height: virtualizer.getTotalSize() }}>
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-20 flex border-b bg-background"
          style={{ width, height: HEADER_HEIGHT }}
        >
          <div
            role="columnheader"
            className="sticky left-0 z-30 flex items-center border-r bg-background px-2 text-xs font-medium"
            style={{ width: FIRST_COLUMN, minWidth: FIRST_COLUMN }}
          >
            {t('panel.calendar.property')}
          </div>
          {days.map((day) => (
            <div
              key={day}
              role="columnheader"
              data-day={day}
              aria-current={day === today ? 'date' : undefined}
              title={fullDayLabel(day, locale)}
              className={`flex items-center justify-center border-r text-xs ${
                day === today ? 'bg-accent font-semibold' : ''
              }`}
              style={{ width: dayWidth, minWidth: dayWidth }}
            >
              {dayLabel(day, locale, depth)}
            </div>
          ))}
        </div>

        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const property = row.node.row;

          return (
            <div
              key={item.key}
              role="row"
              // Only the rows that fit are in the DOM: the index says where
              // each stands among all of them (aria-rowcount).
              aria-rowindex={item.index + 2}
              // top-0: without it a row starts at its static place under the
              // sticky header, and the header's height is counted twice.
              className="absolute top-0 left-0 flex border-b"
              style={{ width, height: item.size, transform: `translateY(${item.start}px)` }}
            >
              <GridRow
                row={row}
                house={property.parent_id === null ? undefined : byId.get(property.parent_id)}
                isClosed={collapsed.has(property.id)}
                layout={layout.get(property.id)}
                byRowDay={byRowDay}
                repairAlerts={repairAlerts}
                days={days}
                dayWidth={dayWidth}
                dayLines={dayLines}
                bookings={bookings}
                highlighted={highlighted}
                chipView={chipView}
                language={language}
                unread={unread}
                onToggleGroup={onToggleGroup}
                onPoint={setHighlighted}
                onOpenBooking={onOpenBooking}
                onOpenTask={onOpenTask}
                onMoreTasks={onMoreTasks}
                onEmptyDay={onEmptyDay}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
