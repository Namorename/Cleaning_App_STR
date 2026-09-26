'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { propertyPath, type Language } from '@str-ops/shared';

import { Badge } from '@/components/ui/badge';
import type { Property } from '@/features/tasks/schema';
import type { VisibleRow } from '@/lib/property-tree';

import type { RowLayout } from './bars';
import { DAY_WIDTH, dayLabel, fullDayLabel, type Depth } from './dates';
import { RowTrack } from './row-track';
import type { CalendarBooking } from './schema';

/** The property column; the days start after it. */
const FIRST_COLUMN = 240;
const HEADER_HEIGHT = 40;
/**
 * A row's height does not depend on the data of the window (§4): one track of
 * bars and one line of chips, a constant per kind of row. Otherwise rows would
 * jump under the cursor on every arrow and every month read.
 */
const LISTING_HEIGHT = 44;
const ROOM_HEIGHT = 36;
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
  language: Language;
  onOpenBooking: (booking: CalendarBooking) => void;
}

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
  language,
  onOpenBooking,
}: CalendarGridProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement>(null);
  // Pointing at one bar of a stay of several rooms lights all of them (§3).
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const dayWidth = DAY_WIDTH[depth];
  const width = FIRST_COLUMN + days.length * dayWidth;

  // The compiler cannot memoize a component that holds a virtualizer, and
  // should not: the grid redraws on every scroll by design (§4).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (at) => (rows[at].depth === 0 ? LISTING_HEIGHT : ROOM_HEIGHT),
    getItemKey: (at) => rows[at].node.row.id,
    overscan: 8,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
  });

  const byId = new Map(all.map((one) => [one.id, one]));
  const dayLines = `repeating-linear-gradient(to right, transparent 0 ${dayWidth - 1}px, var(--border) ${dayWidth - 1}px ${dayWidth}px)`;

  return (
    <div
      ref={scroller}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-colcount={days.length + 1}
      className="relative min-h-0 flex-1 overflow-auto rounded-md border"
    >
      <div className="relative" style={{ width, height: virtualizer.getTotalSize() }}>
        <div
          role="row"
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
          const { node, depth: level } = rows[item.index];
          const property = node.row;
          const isGroup = node.children.length > 0;
          const isClosed = collapsed.has(property.id);
          const house = property.parent_id === null ? undefined : byId.get(property.parent_id);

          return (
            <div
              key={item.key}
              role="row"
              // top-0: without it a row starts at its static place under the
              // sticky header, and the header's height is counted twice.
              className="absolute top-0 left-0 flex border-b"
              style={{ width, height: item.size, transform: `translateY(${item.start}px)` }}
            >
              <div
                role="rowheader"
                aria-label={
                  house === undefined ? property.name : propertyPath(house.name, property.name)
                }
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
                  <Badge variant="outline" className="shrink-0">
                    {t('panel.apartments.tabs.maintenance')}
                  </Badge>
                ) : null}
              </div>
              <RowTrack
                layout={layout.get(property.id)}
                days={days}
                dayWidth={dayWidth}
                dayLines={dayLines}
                isClosedGroup={isGroup && isClosed}
                unitCount={node.children.length}
                highlighted={highlighted}
                language={language}
                onPoint={setHighlighted}
                onOpen={onOpenBooking}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
