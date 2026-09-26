'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { FALLBACK_LANGUAGE, INTL_LOCALES, isSupportedLanguage } from '@str-ops/shared';

import { Button } from '@/components/ui/button';
import { todayIso } from '@/lib/format-date';
import { buildPropertyTree, visibleRows } from '@/lib/property-tree';
import { layoutRows } from './bars';
import { BookingCard } from './booking-card';
import { CalendarFilters } from './calendar-filters';
import { CalendarGrid } from './calendar-grid';
import {
  ANY_ASSIGNEE,
  matchesChipFilters,
  offListAssignees,
  tasksByRowDay,
  type AssigneeFilter,
  type StatusFilter,
} from './chips';
import { addDays, DEPTHS, defaultStart, rangeLabel, windowDays, type Depth } from './dates';
import { LayerAlert } from './layer-alert';
import type { CalendarBooking } from './schema';
import { readCollapsed, readDepth, writeCollapsed, writeDepth } from './storage';
import { useTaskDialogs } from './task-dialogs';
import {
  useCalendarBookings,
  useCalendarClient,
  useCalendarRows,
  useCalendarStaff,
  useCalendarTasks,
} from './use-calendar';

interface CalendarViewProps {
  /** The stand: data from the fixture instead of the database (§5). */
  fixture?: boolean;
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
export function CalendarView({ fixture = false }: CalendarViewProps) {
  const { t } = useTranslation();
  const isBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

  if (!isBrowser) {
    return <p className="text-sm text-muted-foreground">{t('panel.calendar.loadingRows')}</p>;
  }
  return <CalendarBody isStand={fixture} />;
}

function toggled(ids: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function CalendarBody({ isStand }: { isStand: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useCalendarClient(isStand);
  const rowsQuery = useCalendarRows(client, isStand);

  const today = todayIso();
  const [depth, setDepth] = useState<Depth>(() => readDepth());
  const [start, setStart] = useState(() => defaultStart(today));
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => readCollapsed());
  const [opened, setOpened] = useState<CalendarBooking | null>(null);

  const language = isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE;
  const locale = INTL_LOCALES[language];
  const days = useMemo(() => windowDays(start, depth), [start, depth]);
  const all = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const byId = useMemo(() => new Map(all.map((one) => [one.id, one])), [all]);
  const tree = useMemo(() => buildPropertyTree(all), [all]);
  const rows = useMemo(() => visibleRows(tree, collapsed), [tree, collapsed]);
  const rooms = all.filter((one) => one.hostaway_unit_id !== null).length;

  // Bars are drawn only when every month of the window has come (§1).
  const bookings = useCalendarBookings(client, isStand, days);
  const layout = useMemo(
    () => layoutRows(tree, bookings.data ?? [], days),
    [tree, bookings.data, days],
  );
  // Null until read: a chip is not judged against bookings that have not come.
  const bookingsById = useMemo(
    () => (bookings.data === undefined ? null : new Map(bookings.data.map((one) => [one.id, one]))),
    [bookings.data],
  );

  // Chips, likewise, only when every month has come; the filters act on them alone.
  const tasks = useCalendarTasks(client, isStand, days);
  const staff = useCalendarStaff(client, isStand);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>(ANY_ASSIGNEE);
  const byRowDay = useMemo(
    () =>
      tasksByRowDay(
        (tasks.data ?? []).filter((task) => matchesChipFilters(task, statusFilter, assigneeFilter)),
      ),
    [tasks.data, statusFilter, assigneeFilter],
  );
  const offList = useMemo(
    () => (staff.data === undefined ? [] : offListAssignees(tasks.data ?? [], staff.data)),
    [tasks.data, staff.data],
  );
  // A person who left, once chosen, keeps an option after the window moves
  // past their chips: otherwise the select shows «Все» over an empty grid.
  const [chosenName, setChosenName] = useState<string | null>(null);
  const chooseAssignee = (next: AssigneeFilter) => {
    setAssigneeFilter(next);
    setChosenName(offList.find((person) => person.id === next)?.name ?? null);
  };
  const shownOffList =
    chosenName !== null &&
    !offList.some((person) => person.id === assigneeFilter) &&
    !(staff.data ?? []).some((person) => person.id === assigneeFilter)
      ? [...offList, { id: assigneeFilter, name: chosenName }]
      : offList;
  const taskDialogs = useTaskDialogs({ isStand, language, bookings: bookingsById });

  const chooseDepth = (next: Depth) => {
    setDepth(next);
    writeDepth(next);
  };
  const toggleGroup = (id: number) => {
    const next = toggled(collapsed, id);
    setCollapsed(next);
    writeCollapsed(next);
  };

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{t('panel.nav.calendar')}</h1>
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
        {tasks.isPending ? (
          <span className="text-sm text-muted-foreground">{t('panel.calendar.loadingTasks')}</span>
        ) : null}
      </div>

      {bookings.isError ? (
        <LayerAlert message={t('panel.calendar.bookingsError')} error={bookings.error} />
      ) : null}
      {tasks.isError ? (
        <LayerAlert message={t('panel.calendar.tasksError')} error={tasks.error} />
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
        status={statusFilter}
        onStatus={setStatusFilter}
        assignee={assigneeFilter}
        onAssignee={chooseAssignee}
        staff={staff.data ?? []}
        offList={shownOffList}
        onNewTask={taskDialogs.newTask}
      />

      {rowsQuery.data === undefined && rowsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.calendar.rowsError')}
        </p>
      ) : rowsQuery.data === undefined ? (
        <p className="text-sm text-muted-foreground">{t('panel.calendar.loadingRows')}</p>
      ) : all.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.calendar.empty')}</p>
      ) : (
        <CalendarGrid
          rows={rows}
          all={all}
          days={days}
          depth={depth}
          today={today}
          locale={locale}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          layout={layout}
          byRowDay={byRowDay}
          bookings={bookingsById}
          language={language}
          onOpenBooking={setOpened}
          onOpenTask={taskDialogs.openTask}
          onMoreTasks={taskDialogs.showCell}
          onEmptyDay={taskDialogs.newTaskOn}
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
