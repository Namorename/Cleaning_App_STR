'use client';

import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { canSetCleaningTime, type Task } from './schema';
import { useClearCleaningTime } from './use-tasks';

interface ManualTimeNoteProps {
  /** A booking's cleaning: the one whose hours the server writes from the booking. */
  task: Task;
  /** The draft holds hours set by hand. */
  isManual: boolean;
  /** Hours set by hand without both ends, or the start not before the end. */
  hasGap: boolean;
  /** Ties the sentence to the time fields while they are the booking's. */
  hintId: string;
  onStart: () => void;
  onCancel: () => void;
  /** The cleaning went back to the booking's hours: the dialog closes. */
  onCleared: () => void;
}

/**
 * What the manager reads under the hours of a booking's cleaning, and the one
 * button that changes who sets them (20261027120000):
 *   * the booking's: the server sets them — and, nobody having started it,
 *     «set the hours by hand» opens the fields;
 *   * set by hand: they hold while the cleaning keeps its day, and «back to the
 *     booking's hours» gives them back at once;
 *   * a change of day undid hand-set hours: said where it cannot be missed, with
 *     the day they were for, until the manager has seen it or sets new ones.
 */
export function ManualTimeNote({
  task,
  isManual,
  hasGap,
  hintId,
  onStart,
  onCancel,
  onCleared,
}: ManualTimeNoteProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const clear = useClearCleaningTime();
  const canSet = canSetCleaningTime(task);
  const isSaved = task.manual_time_on !== null;
  const failure = clear.isError ? serverErrorText(clear.error) : null;

  const back = () =>
    clear.mutate({ taskId: task.id, expectedDate: task.scheduled_date }, { onSuccess: onCleared });

  return (
    <div className="flex flex-col gap-2">
      {canSet && !isManual && task.manual_time_lost_on !== null ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-tone-overdue-border p-3 text-sm"
        >
          <p>
            {t('panel.tasks.form.manualTimeLost', {
              date: formatDay(task.manual_time_lost_on, language),
            })}
          </p>
          <div>
            <Button type="button" variant="outline" disabled={clear.isPending} onClick={back}>
              {t('panel.tasks.form.manualTimeLostOk')}
            </Button>
          </div>
        </div>
      ) : null}

      {isManual || isSaved ? (
        <p id={hintId} className="text-xs font-medium">
          {isSaved ? t('panel.tasks.form.manualTimeOn') : t('panel.tasks.form.manualTimeNew')}
        </p>
      ) : (
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('panel.tasks.form.windowFromBooking')}
        </p>
      )}

      {isManual && hasGap ? (
        <p role="alert" className="text-xs text-destructive">
          {t('serverErrors.cleaningTimeInvalid')}
        </p>
      ) : null}

      {canSet ? (
        <div className="flex flex-wrap gap-2">
          {!isManual ? (
            <Button type="button" variant="outline" size="sm" onClick={onStart}>
              {t('panel.tasks.form.manualTimeSet')}
            </Button>
          ) : isSaved ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clear.isPending}
              onClick={back}
            >
              {t('panel.tasks.form.manualTimeBack')}
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t('panel.tasks.form.manualTimeCancel')}
            </Button>
          )}
        </div>
      ) : null}

      {failure === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
    </div>
  );
}
