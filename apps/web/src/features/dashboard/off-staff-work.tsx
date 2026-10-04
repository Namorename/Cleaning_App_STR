'use client';

import { propertyPathOf } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { EmptyState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import type { OffStaffTask } from '@/features/tasks/schema';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

/** Where the «Уборок у отключённых» tile leads. */
export const OFF_STAFF_WORK_ID = 'off-staff-work';
const TITLE_ID = 'off-staff-work-title';

interface OffStaffWorkProps {
  /** Undefined until the work is read, or when it could not be. */
  work: readonly OffStaffTask[] | undefined;
  isError: boolean;
  /** Open a job for the manager's decision. */
  onOpen: (taskId: string) => void;
}

/**
 * The work under way on people switched off, oldest first
 * (docs/staff-disable-plan.md). Switching an account off took it off every
 * job nobody had started; these it had started, and each waits for the
 * manager to hand it on — left alone, the night sweep closes it a day after
 * its day as one that never happened (expire_stale_tasks). The place, the
 * day, the job, its state, who left it, and the job itself to open.
 */
export function OffStaffWork({ work, isError, onOpen }: OffStaffWorkProps) {
  const { t } = useTranslation();

  return (
    <section id={OFF_STAFF_WORK_ID} className="flex scroll-mt-4 flex-col gap-2">
      <h2 id={TITLE_ID} className="text-lg font-semibold">
        {t('panel.dashboard.offWork.title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('panel.dashboard.offWork.hint')}</p>
      {work === undefined ? (
        // A failed read says so at the top of the page, once.
        isError ? null : <LoadingState>{t('panel.dashboard.offWork.loading')}</LoadingState>
      ) : work.length === 0 ? (
        <EmptyState>{t('panel.dashboard.offWork.empty')}</EmptyState>
      ) : (
        <ul
          aria-labelledby={TITLE_ID}
          className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10"
        >
          {work.map((task) => (
            <OffStaffWorkRow key={task.id} task={task} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface OffStaffWorkRowProps {
  task: OffStaffTask;
  onOpen: (taskId: string) => void;
}

function OffStaffWorkRow({ task, onOpen }: OffStaffWorkRowProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const place = propertyPathOf(task.property);
  const day = formatDay(task.scheduled_date, language);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      <span className="font-medium">{place}</span>
      <span className="text-muted-foreground">{day}</span>
      <span>{t(`panel.tasks.types.${task.type}`)}</span>
      <span>{t(`panel.tasks.statuses.${task.status}`)}</span>
      <span>{task.assignee.full_name ?? t('panel.dashboard.offWork.noName')}</span>
      <span className="text-destructive">{t('panel.dashboard.offWork.personOff')}</span>
      <Button
        type="button"
        variant="link"
        className="ml-auto h-auto p-0"
        onClick={() => onOpen(task.id)}
      >
        {t('panel.dashboard.offWork.open')}
        {/* A screen reader's list of controls shows them alone: each says
            which job, and still begins with the words on screen. */}
        <span className="sr-only">
          : {place}, {day}
        </span>
      </Button>
    </li>
  );
}
