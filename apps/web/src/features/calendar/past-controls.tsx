'use client';

import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';

import { PAST_LIMIT_DAYS } from './dates';
import type { CalendarPast } from './use-past';

interface PastControlsProps {
  past: CalendarPast;
}

/**
 * «Показать прошлое» (the owner's word of 2026-10-10, block 7): the way to the
 * past for the keyboard and the touch, beside the left edge's own. At sixty
 * days back it says that is the limit and does nothing — disabled for the
 * reader (`aria-disabled`) but still focusable, so the keyboard's focus is
 * not dropped on the last press (review 2026-10-10). While a chunk loads it
 * stays as it is: the status line says so, and a second press asks nothing.
 */
export function PastButton({ past }: PastControlsProps) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={past.isAtLimit}
      focusableWhenDisabled
      className="aria-disabled:opacity-50"
      onClick={() => past.loadMore('button')}
    >
      {past.isAtLimit
        ? t('panel.calendar.past.limit', { count: PAST_LIMIT_DAYS })
        : t('panel.calendar.past.show')}
    </Button>
  );
}

/** A polite line that a chunk is on its way; there always, so it is heard. */
export function PastStatus({ past }: PastControlsProps) {
  const { t } = useTranslation();
  return (
    <span role="status" className="text-sm text-muted-foreground">
      {past.isLoading ? t('panel.calendar.past.loading') : null}
    </span>
  );
}

/** A chunk that did not come: says so, the server's words under it, and asks again. */
export function PastFailure({ past }: PastControlsProps) {
  const { t } = useTranslation();
  if (!past.isError) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ErrorState message={t('panel.calendar.past.error')} error={past.error} />
      <Button type="button" variant="outline" size="sm" onClick={() => past.loadMore('button')}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
