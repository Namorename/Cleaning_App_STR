'use client';

import { propertyPathOf } from '@str-ops/shared';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { StuckRepair } from './counts';

/** Where the two repair tiles lead. */
export const STUCK_REPAIRS_ID = 'stuck-repairs';
const TITLE_ID = 'stuck-repairs-title';

interface StuckRepairsProps {
  /** Undefined until the repairs are read, or when they could not be. */
  stuck: readonly StuckRepair[] | undefined;
  isError: boolean;
}

/**
 * The repairs the two counters count, oldest first (docs/dashboard-plan.md):
 * the place, the day, who is on it, which signal it gives, and the task it
 * fixes. A repair that gives both is one row with both marks.
 */
export function StuckRepairs({ stuck, isError }: StuckRepairsProps) {
  const { t } = useTranslation();

  return (
    <section id={STUCK_REPAIRS_ID} className="flex scroll-mt-4 flex-col gap-2">
      <h2 id={TITLE_ID} className="text-lg font-semibold">
        {t('panel.dashboard.repairs.title')}
      </h2>
      {stuck === undefined ? (
        // A failed read says so at the top of the page, once.
        isError ? null : (
          <p className="text-sm text-muted-foreground">{t('panel.dashboard.repairs.loading')}</p>
        )
      ) : stuck.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.dashboard.repairs.empty')}</p>
      ) : (
        <ul
          aria-labelledby={TITLE_ID}
          className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10"
        >
          {stuck.map((one) => (
            <StuckRepairRow key={one.repair.id} stuck={one} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StuckRepairRow({ stuck }: { stuck: StuckRepair }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { repair, isOverdue, isTechnicianOff } = stuck;
  const technician =
    repair.assignee_id === null
      ? t('panel.dashboard.repairs.nobody')
      : (repair.assignee?.full_name ?? t('panel.dashboard.repairs.noName'));
  const place = propertyPathOf(repair.property);
  const day = formatDay(repair.scheduled_date, language);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="font-medium">{place}</span>
      <span className="text-muted-foreground">{day}</span>
      <span>{technician}</span>
      {isTechnicianOff ? (
        <span className="text-destructive">{t('panel.dashboard.repairs.technicianOff')}</span>
      ) : null}
      {isOverdue ? (
        <span className="font-medium text-destructive">{t('panel.dashboard.repairs.overdue')}</span>
      ) : null}
      <Link
        href={`/problems/${repair.problem_id}`}
        className="ml-auto text-primary underline-offset-4 hover:underline"
      >
        {t('panel.dashboard.repairs.open')}
        {/* A screen reader's list of links shows the links alone: each says
            which repair, and still begins with the words on screen. */}
        <span className="sr-only">
          : {place}, {day}
        </span>
      </Link>
    </li>
  );
}
