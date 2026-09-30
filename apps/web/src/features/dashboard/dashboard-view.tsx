'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LayerAlert } from '@/features/calendar/layer-alert';
import { cn } from '@/lib/utils';

import {
  cleaningsToday,
  newSupplyCount,
  openProblemCount,
  REFRESH_MS,
  repairCounts,
  stuckRepairs,
  unassignedAhead,
} from './counts';
import { STUCK_REPAIRS_ID, StuckRepairs } from './stuck-repairs';
import { useDashboard } from './use-dashboard';
import { useNow } from './use-now';

/** A figure on its way: not a zero, which would be a claim. */
const PENDING = '…';
/** A figure that could not be read; the page says which above the tiles. */
const FAILED = '—';

interface Read<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
}

function figure<T>(read: Read<T>, value: (data: T) => string): string {
  if (read.data !== undefined) {
    return value(read.data);
  }
  return read.isError ? FAILED : PENDING;
}

interface TileProps {
  href: string;
  label: string;
  value: string;
  /** Something to chase: the figure turns red. The label says it in words too. */
  isAlert?: boolean;
  children?: ReactNode;
}

/** One figure, and the whole tile leads to where it is counted from. */
function Tile({ href, label, value, isAlert = false, children }: TileProps) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-3xl font-semibold tabular-nums', isAlert && 'text-destructive')}>
        {value}
      </span>
      {children}
    </Link>
  );
}

/** Today and tomorrow apart from the week, and marked when there is one (owner, 2026-09-29). */
function UnassignedDays({ today, tomorrow }: { today: number; tomorrow: number }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="text-xs text-muted-foreground">
        {t('panel.dashboard.tiles.unassignedWeek')}
      </span>
      <span className="flex flex-wrap gap-x-3 text-sm">
        <span className={today > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>
          {t('panel.dashboard.tiles.unassignedToday', { number: today })}
        </span>
        <span className={tomorrow > 0 ? 'font-medium' : 'text-muted-foreground'}>
          {t('panel.dashboard.tiles.unassignedTomorrow', { number: tomorrow })}
        </span>
      </span>
    </>
  );
}

/**
 * The basic dashboard (docs/dashboard-plan.md): six figures and the repairs
 * left behind, each tile leading to its section. Read by the sections'
 * readers, judged again every minute at the listing's own today.
 */
export function DashboardView() {
  const { t } = useTranslation();
  const now = useNow(REFRESH_MS);
  const { tasks, problems, supplies, repairs } = useDashboard(now);

  const unassigned = tasks.data === undefined ? undefined : unassignedAhead(tasks.data, now);
  const stuck = repairs.data === undefined ? undefined : stuckRepairs(repairs.data, now);
  const repairTotals = stuck === undefined ? undefined : repairCounts(stuck);

  const failures = [
    { read: tasks, messageKey: 'panel.dashboard.errors.tasks' },
    { read: problems, messageKey: 'panel.dashboard.errors.problems' },
    { read: supplies, messageKey: 'panel.dashboard.errors.supplies' },
    { read: repairs, messageKey: 'panel.dashboard.errors.repairs' },
  ].filter(({ read }) => read.isError);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('panel.nav.dashboard')}</h1>

      {failures.map(({ read, messageKey }) => (
        <LayerAlert key={messageKey} message={t(messageKey)} error={read.error} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          href="/tasks"
          label={t('panel.dashboard.tiles.cleaningsToday')}
          value={figure(tasks, (data) =>
            t('panel.dashboard.tiles.cleaningsTodayValue', { ...cleaningsToday(data, now) }),
          )}
        />
        <Tile
          href="/calendar?assignee=nobody"
          label={t('panel.dashboard.tiles.unassigned')}
          value={figure(tasks, () => String(unassigned?.week ?? 0))}
        >
          {unassigned === undefined ? null : (
            <UnassignedDays today={unassigned.today} tomorrow={unassigned.tomorrow} />
          )}
        </Tile>
        <Tile
          href="/problems"
          label={t('panel.dashboard.tiles.openProblems')}
          value={figure(problems, (data) => String(openProblemCount(data)))}
        />
        <Tile
          href="/supplies"
          label={t('panel.dashboard.tiles.newSupplies')}
          value={figure(supplies, (data) => String(newSupplyCount(data)))}
        />
        <Tile
          href={`#${STUCK_REPAIRS_ID}`}
          label={t('panel.dashboard.tiles.overdueRepairs')}
          value={figure(repairs, () => String(repairTotals?.overdue ?? 0))}
          isAlert={(repairTotals?.overdue ?? 0) > 0}
        />
        <Tile
          href={`#${STUCK_REPAIRS_ID}`}
          label={t('panel.dashboard.tiles.offRepairs')}
          value={figure(repairs, () => String(repairTotals?.technicianOff ?? 0))}
          isAlert={(repairTotals?.technicianOff ?? 0) > 0}
        />
      </div>

      <StuckRepairs stuck={stuck} isError={repairs.isError} />
    </div>
  );
}
