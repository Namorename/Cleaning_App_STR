'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { FALLBACK_LANGUAGE, INTL_LOCALES, isSupportedLanguage } from '@str-ops/shared';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { overdueRepairsByProperty } from '@/features/tasks/repairs';
import { todayIso } from '@/lib/format-date';
import { buildPropertyTree, rowsMatching, visibleRows } from '@/lib/property-tree';
import { matchesAllTokens } from '@/lib/search';
import { layoutRows } from './bars';
import { BookingCard } from './booking-card';
import { CalendarFilters } from './calendar-filters';
import { CalendarGrid } from './calendar-grid';
import type { AssigneeFilter, BookingsRead, ChipView } from './chips';
import {
  addDays,
  DEPTHS,
  defaultStart,
  monthBounds,
  monthsOf,
  openingWindow,
  rangeLabel,
  windowDays,
  type Depth,
} from './dates';
import { standOverscan, useStandPaintMark } from './stand-measure';
import type { CalendarBooking } from './schema';
import {
  readChipView,
  readCollapsed,
  readDepth,
  writeChipView,
  writeCollapsed,
  writeDepth,
} from './storage';
import { useTaskDialogs } from './task-dialogs';
import {
  useCalendarBookings,
  useCalendarClient,
  useCalendarRows,
  useLiveRepairs,
} from './use-calendar';
import { useChipLayers } from './use-chip-layers';

interface CalendarViewProps {
  /** The stand: data from the fixture instead of the database (§5). */
  fixture?: boolean;
  /** The stand's fixture this many times over: 1 or 3 (7.6). */
  scale?: number;
  /** The assignee filter the address opens on (`assigneeFromAddress`). */
  initialAssignee?: AssigneeFilter;
  /** Open on today and at least this many days (`openingWindow`); not remembered. */
  openAheadDays?: number;
}

const noSubscription = () => () => {};

/**
 * The calendar (docs/f10-plan.md, stage 7): listings and rooms down, days
 * across. 7.2 is the frame — the window, the controls and the rows; bookings,
 * tasks and repairs are drawn on it by 7.3–7.5.
 *
 * What the manager chose last time lives in the browser, so the body renders
 * in the browser only: a server render with a week and every group open would
 * then be corrected in front of her.
 */
export function CalendarView({
  fixture = false,
  scale = 1,
  initialAssignee,
  openAheadDays,
}: CalendarViewProps) {
  const { t } = useTranslation();
  const isBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  if (!isBrowser) {
    return <LoadingState>{t('panel.calendar.loadingRows')}</LoadingState>;
  }
  return (
    <CalendarBody
      isStand={fixture}
      scale={scale}
      initialAssignee={initialAssignee}
      openAheadDays={openAheadDays}
    />
  );
}

/** While a search runs every group stands open. */
const NONE_CLOSED: ReadonlySet<number> = new Set();

function toggled(ids: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

interface CalendarBodyProps {
  isStand: boolean;
  scale: number;
  initialAssignee?: AssigneeFilter;
  openAheadDays?: number;
}

function CalendarBody({ isStand, scale, initialAssignee, openAheadDays }: CalendarBodyProps) {
  const { t, i18n } = useTranslation();
  const client = useCalendarClient(isStand, scale);
  const rowsQuery = useCalendarRows(client, isStand);

  const today = todayIso();
  // Read once: an opening asked from the dashboard is not remembered as her depth.
  const [opening] = useState(() => openingWindow(today, readDepth(), openAheadDays ?? null));
  const [depth, setDepth] = useState<Depth>(opening.depth);
  const [chipView, setChipView] = useState<ChipView>(() => readChipView());
  const [start, setStart] = useState(opening.start);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => readCollapsed());
  const [opened, setOpened] = useState<CalendarBooking | null>(null);
  const [search, setSearch] = useState('');

  const language = isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
  const locale = INTL_LOCALES[language];
  const days = useMemo(() => windowDays(start, depth), [start, depth]);
  const all = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const byId = useMemo(() => new Map(all.map((one) => [one.id, one])), [all]);
  // A search keeps what is found and opens its groups, as in the registry; the
  // groups closed before it are closed again once it is cleared.
  const isSearching = search.trim() !== '';
  const shown = useMemo(
    () => (isSearching ? rowsMatching(all, (one) => matchesAllTokens(one.name, search)) : all),
    [all, isSearching, search],
  );
  const closed = isSearching ? NONE_CLOSED : collapsed;
  const tree = useMemo(() => buildPropertyTree(shown), [shown]);
  const rows = useMemo(() => visibleRows(tree, closed), [tree, closed]);
  const rooms = all.filter((one) => one.hostaway_unit_id !== null).length;

  // Bars are drawn only when every month of the window has come (§1).
  const bookings = useCalendarBookings(client, isStand, days);
  const layout = useMemo(
    () => layoutRows(tree, bookings.data ?? [], days),
    [tree, bookings.data, days],
  );
  // Null until read: a chip is not judged against bookings that have not come.
  // The months read ride along, so a moved chip is not judged against a
  // booking that was never asked for (chips.ts, isStayRead).
  const bookingsRead = useMemo((): BookingsRead | null => {
    if (bookings.data === undefined) {
      return null;
    }
    const months = monthsOf(days);
    return {
      byId: new Map(bookings.data.map((one) => [one.id, one])),
      from: monthBounds(months[0]).from,
      to: monthBounds(months[months.length - 1]).to,
    };
  }, [bookings.data, days]);

  // Chips, likewise, only when every month has come; the filters act on them alone.
  const chips = useChipLayers({ client, isStand, days, byId, initialAssignee });
  const taskDialogs = useTaskDialogs({ isStand, language, bookings: bookingsRead });

  // A repair left behind shows in its row's first column, whatever the window (§6).
  const repairs = useLiveRepairs(client, isStand);
  // Judged now, like the chips: a memo would keep yesterday's today (a handful of rows).
  const repairAlerts = overdueRepairsByProperty(repairs.data ?? []);

  // The stand's measurement (7.6): the first drawing with every layer in.
  useStandPaintMark(
    isStand,
    rowsQuery.data !== undefined &&
      bookings.data !== undefined &&
      !chips.isPending &&
      !repairs.isPending,
  );

  // The window stays where it is: every depth opens on the same day.
  const chooseDepth = (next: Depth) => {
    setDepth(next);
    writeDepth(next);
  };
  const chooseChipView = (next: ChipView) => {
    setChipView(next);
    writeChipView(next);
  };
  const toggleGroup = (id: number) => {
    const next = toggled(collapsed, id);
    setCollapsed(next);
    writeCollapsed(next);
  };

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col gap-3">
      <PageHeader
        title={t('panel.nav.calendar')}
        meta={
          <>
            {rowsQuery.data === undefined ? null : (
              <span className="text-sm text-muted-foreground">
                {t('panel.calendar.counts', { listings: all.length - rooms, rooms })}
              </span>
            )}
            {bookings.isPending ? (
              <span className="text-sm text-muted-foreground">
                {t('panel.calendar.loadingBookings')}
              </span>
            ) : null}
            {chips.isPending || repairs.isPending ? (
              <span className="text-sm text-muted-foreground">
                {t('panel.calendar.loadingTasks')}
              </span>
            ) : null}
          </>
        }
      />

      {bookings.isError ? (
        <ErrorState message={t('panel.calendar.bookingsError')} error={bookings.error} />
      ) : null}
      {chips.failures.map((failure) => (
        <ErrorState
          key={failure.messageKey}
          message={t(failure.messageKey)}
          error={failure.error}
        />
      ))}
      {repairs.isError ? (
        <ErrorState message={t('panel.calendar.repairsError')} error={repairs.error} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setStart(defaultStart(today))}
        >
          {t('panel.calendar.today')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('panel.calendar.previous')}
          onClick={() => setStart(addDays(start, -depth))}
        >
          ‹
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t('panel.calendar.next')}
          onClick={() => setStart(addDays(start, depth))}
        >
          ›
        </Button>
        <span className="text-sm">{rangeLabel(days, locale)}</span>
        <Input
          type="search"
          className="h-8 w-full sm:w-56"
          placeholder={t('panel.calendar.search')}
          aria-label={t('panel.calendar.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div
          role="group"
          aria-label={t('panel.calendar.depthLabel')}
          className="ml-auto flex gap-1"
        >
          {DEPTHS.map((one) => (
            <Button
              key={one}
              type="button"
              size="sm"
              variant={one === depth ? 'default' : 'outline'}
              aria-pressed={one === depth}
              onClick={() => chooseDepth(one)}
            >
              {t('panel.calendar.days', { count: one })}
            </Button>
          ))}
        </div>
      </div>

      <CalendarFilters
        {...chips.filters}
        chipView={chipView}
        onChipView={chooseChipView}
        onNewTask={taskDialogs.newTask}
      />

      {rowsQuery.data === undefined && rowsQuery.isError ? (
        <ErrorState message={t('panel.calendar.rowsError')} error={rowsQuery.error} />
      ) : rowsQuery.data === undefined ? (
        <LoadingState>{t('panel.calendar.loadingRows')}</LoadingState>
      ) : all.length === 0 ? (
        <EmptyState>{t('panel.calendar.empty')}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>{t('panel.calendar.noMatches')}</EmptyState>
      ) : (
        <CalendarGrid
          rows={rows}
          all={all}
          days={days}
          depth={depth}
          today={today}
          locale={locale}
          collapsed={closed}
          onToggleGroup={toggleGroup}
          layout={layout}
          byRowDay={chips.byRowDay}
          repairAlerts={repairAlerts}
          bookings={bookingsRead}
          chipView={chipView}
          language={language}
          onOpenBooking={setOpened}
          onOpenTask={taskDialogs.openTask}
          onMoreTasks={taskDialogs.showCell}
          onEmptyDay={taskDialogs.newTaskOn}
          overscan={standOverscan(isStand, rows.length)}
        />
      )}

      <BookingCard
        booking={opened}
        byId={byId}
        language={language}
        onClose={() => setOpened(null)}
      />
      {taskDialogs.dialogs}
    </div>
  );
}
