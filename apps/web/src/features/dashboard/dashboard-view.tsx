'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { cn } from '@/lib/utils';

import {
  cleaningsToday,
  newSupplyCount,
  offStaffWork,
  openProblemCount,
  REFRESH_MS,
  repairCounts,
  stuckRepairs,
  unassignedAhead,
} from './counts';
import { OFF_STAFF_WORK_ID, OffStaffWork } from './off-staff-work';
import { OffWorkForm } from './off-work-form';
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

/** A figure counted over `reads`: undefined until every one of them has come. */
function shown(value: string | undefined, reads: readonly Read<unknown>[]): string {
  if (value !== undefined) {
    return value;
  }
  return reads.some((read) => read.data === undefined && read.isError) ? FAILED : PENDING;
}

/**
 * Next scrolls to an in-page anchor on the first click only: at the same
 * `#stuck-repairs` a second click is no navigation (dashboard preflight). The
 * link stays a Link — a plain anchor's history entry breaks Back in the app
 * router — and the scroll is done here as well.
 */
function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView();
}

interface TileProps {
  href: string;
  label: string;
  value: string;
  /** Something to chase: the figure turns red. The label says it in words too. */
  isAlert?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}

/** One figure, and the whole tile leads to where it is counted from. */
function Tile({ href, label, value, isAlert = false, onClick, children }: TileProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
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
 * The basic dashboard (docs/dashboard-plan.md): seven figures, the repairs
 * left behind and the work people switched off had started
 * (docs/staff-disable-plan.md), each tile leading to its section or list.
 * Read by the sections' readers, judged again every minute at the listing's
 * own today.
 */
export function DashboardView() {
  const { t } = useTranslation();
  const now = useNow(REFRESH_MS);
  const { tasks, problems, supplies, repairs, rows, offWork } = useDashboard(now);
  // The job of a person switched off the manager opened for a decision.
  const [opening, setOpening] = useState<string | null>(null);

  const cleanings = tasks.data === undefined ? undefined : cleaningsToday(tasks.data, now);
  const unassigned =
    tasks.data === undefined || rows.data === undefined
      ? undefined
      : unassignedAhead(tasks.data, new Set(rows.data.map((row) => row.id)), now);
  const stuck = repairs.data === undefined ? undefined : stuckRepairs(repairs.data, now);
  const repairTotals = stuck === undefined ? undefined : repairCounts(stuck);
  const off = offWork.data === undefined ? undefined : offStaffWork(offWork.data);

  const failures = [
    { read: tasks, messageKey: 'panel.dashboard.errors.tasks' },
    { read: rows, messageKey: 'panel.dashboard.errors.listings' },
    { read: problems, messageKey: 'panel.dashboard.errors.problems' },
    { read: supplies, messageKey: 'panel.dashboard.errors.supplies' },
    { read: repairs, messageKey: 'panel.dashboard.errors.repairs' },
    { read: offWork, messageKey: 'panel.dashboard.errors.offWork' },
  ].filter(({ read }) => read.isError);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.nav.dashboard')} />

      {failures.map(({ read, messageKey }) => (
        <ErrorState key={messageKey} message={t(messageKey)} error={read.error} />
      ))}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          href="/tasks"
          label={t('panel.dashboard.tiles.cleaningsToday')}
          value={shown(
            cleanings && t('panel.dashboard.tiles.cleaningsTodayValue', { ...cleanings }),
            [tasks],
          )}
        />
        <Tile
          href="/calendar?assignee=nobody"
          label={t('panel.dashboard.tiles.unassigned')}
          value={shown(unassigned && String(unassigned.week), [tasks, rows])}
        >
          {unassigned === undefined ? null : (
            <UnassignedDays today={unassigned.today} tomorrow={unassigned.tomorrow} />
          )}
        </Tile>
        <Tile
          href="/problems"
          label={t('panel.dashboard.tiles.openProblems')}
          value={shown(problems.data && String(openProblemCount(problems.data)), [problems])}
        />
        <Tile
          href="/supplies"
          label={t('panel.dashboard.tiles.newSupplies')}
          value={shown(supplies.data && String(newSupplyCount(supplies.data)), [supplies])}
        />
        <Tile
          href={`#${STUCK_REPAIRS_ID}`}
          label={t('panel.dashboard.tiles.overdueRepairs')}
          value={shown(repairTotals && String(repairTotals.overdue), [repairs])}
          isAlert={(repairTotals?.overdue ?? 0) > 0}
          onClick={() => scrollToSection(STUCK_REPAIRS_ID)}
        />
        <Tile
          href={`#${STUCK_REPAIRS_ID}`}
          label={t('panel.dashboard.tiles.offRepairs')}
          value={shown(repairTotals && String(repairTotals.technicianOff), [repairs])}
          isAlert={(repairTotals?.technicianOff ?? 0) > 0}
          onClick={() => scrollToSection(STUCK_REPAIRS_ID)}
        />
        <Tile
          href={`#${OFF_STAFF_WORK_ID}`}
          label={t('panel.dashboard.tiles.offCleanings')}
          value={shown(off && String(off.length), [offWork])}
          isAlert={(off?.length ?? 0) > 0}
          onClick={() => scrollToSection(OFF_STAFF_WORK_ID)}
        />
      </div>

      <StuckRepairs stuck={stuck} isError={repairs.isError} />
      <OffStaffWork work={off} isError={offWork.isError} onOpen={setOpening} />
      {opening === null ? null : (
        <OffWorkForm taskId={opening} onClose={() => setOpening(null)} />
      )}
    </div>
  );
}
