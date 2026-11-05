'use client';

import { STATUS_TONE, type JobTail } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

interface RepairTailProps {
  tail: JobTail | null;
}

/**
 * A live repair's days past its own day (repairTail): «Просрочено» in the
 * overdue tone from OVERDUE_AFTER_DAYS on, and «Висит N дней» from the first
 * day — the marks a cleaning carries in «Уборки» (TaskMarks), in the words of
 * the same keys. Nothing while its day has not passed.
 */
export function RepairTail({ tail }: RepairTailProps) {
  const { t } = useTranslation();

  if (tail === null) {
    return null;
  }
  return (
    <>
      {tail.isOverdue ? (
        <Badge tone={STATUS_TONE['tasks.tail']}>{t('panel.tasks.overdue')}</Badge>
      ) : null}
      <Badge variant="outline">{t('panel.tasks.tail.hanging', { count: tail.days })}</Badge>
    </>
  );
}
