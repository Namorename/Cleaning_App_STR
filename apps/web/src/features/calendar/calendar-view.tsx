'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { FALLBACK_LANGUAGE, INTL_LOCALES, isSupportedLanguage } from '@str-ops/shared';

import { Button } from '@/components/ui/button';
import { todayIso } from '@/lib/format-date';
import { buildPropertyTree, visibleRows } from '@/lib/property-tree';

import { CalendarGrid } from './calendar-grid';
import { addDays, DEPTHS, defaultStart, rangeLabel, windowDays, type Depth } from './dates';
import { readCollapsed, readDepth, writeCollapsed, writeDepth } from './storage';
import { useCalendarClient, useCalendarRows } from './use-calendar';

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

  const locale =
    INTL_LOCALES[isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK_LANGUAGE];
  const days = windowDays(start, depth);
  const all = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const tree = useMemo(() => buildPropertyTree(all), [all]);
  const rows = useMemo(() => visibleRows(tree, collapsed), [tree, collapsed]);
  const rooms = all.filter((one) => one.hostaway_unit_id !== null).length;

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
      </div>

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
        />
      )}
    </div>
  );
}
