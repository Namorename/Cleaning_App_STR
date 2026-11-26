'use client';

import { STATUS_TONE, type Language } from '@str-ops/shared';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { DetailSection } from '@/components/detail-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDay, formatShortDay } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { dueDayRange, plannedDayWords } from './due';
import { livePlannedDay, type Problem } from './schema';
import { useSetProblemDueDate } from './use-problems';

type Translate = (key: string) => string;

/**
 * The day a task is to be done (owner, 2026-11-26; 20261126130000): its label on a card and a row
 * of «Задания», and the office's lever on the task's page.
 */

interface DueBadgeProps {
  problem: Pick<Problem, 'status' | 'due_on' | 'property'>;
  /** One instant for a whole list, so every row agrees on today. */
  now?: Date;
}

/**
 * «Дата: Сегодня» — the planned day of a live task on its card and its row; «Сегодня» in the
 * today tone, any other day plain. Nothing when nothing is planned, or the task is closed.
 */
export function DueBadge({ problem, now }: DueBadgeProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const planned = livePlannedDay(problem, now);
  if (planned === null) {
    return null;
  }
  const text = t('problems.due.chip', {
    when: plannedDayWords(planned, t, (day) => formatShortDay(day, language)),
  });
  return planned.kind === 'today' ? (
    <Badge tone={STATUS_TONE['calendar.today']}>{text}</Badge>
  ) : (
    <Badge variant="outline">{text}</Badge>
  );
}

/** The planned day as the page says it: today, tomorrow, the full date, or «Без даты». */
function dueText(
  problem: Pick<Problem, 'status' | 'due_on' | 'property'>,
  t: Translate,
  language: Language,
): string {
  if (problem.due_on === null) {
    return t('problems.due.none');
  }
  const planned = livePlannedDay(problem);
  const full = formatDay(problem.due_on, language);
  return planned === null || planned.kind === 'past' || planned.kind === 'later'
    ? full
    : `${plannedDayWords(planned, t, () => full)} · ${full}`;
}

interface ProblemDueSectionProps {
  problem: Pick<Problem, 'id' | 'status' | 'due_on' | 'property'>;
  /** The office may plan the day: not on a closed or archived task. */
  canChange: boolean;
}

/**
 * «Дата выполнения» on the task's page: the day, and for the office «Выбрать дату» or «Изменить
 * дату», which opens a date field with «Сохранить дату» and, when one is set, «Убрать дату».
 */
export function ProblemDueSection({ problem, canChange }: ProblemDueSectionProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const [isEditing, setEditing] = useState(false);

  const action =
    canChange && !isEditing ? (
      <Button type="button" variant="outline" className="h-11" onClick={() => setEditing(true)}>
        {problem.due_on === null ? t('problems.due.pick') : t('problems.due.change')}
      </Button>
    ) : null;

  return (
    <DetailSection title={t('problems.due.label')} action={action}>
      {isEditing ? (
        <DueForm problem={problem} onDone={() => setEditing(false)} />
      ) : (
        <p className={problem.due_on === null ? 'text-muted-foreground' : 'font-medium'}>
          {dueText(problem, t, language)}
        </p>
      )}
    </DetailSection>
  );
}

interface DueFormProps {
  problem: Pick<Problem, 'id' | 'due_on'>;
  onDone: () => void;
}

/** The date field, today up to a year ahead, saved or cleared at once. */
function DueForm({ problem, onDone }: DueFormProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const hintId = useId();
  const save = useSetProblemDueDate();
  const [day, setDay] = useState(problem.due_on ?? '');
  const range = dueDayRange();
  const failure = save.isError ? serverErrorText(save.error) : null;

  const send = (dueOn: string | null) => {
    save.mutate({ problemId: problem.id, dueOn }, { onSuccess: onDone });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (day !== '' && !save.isPending) {
      send(day);
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      {/* The section's heading says it on screen; the field still has its own name. */}
      <Label htmlFor={fieldId} className="sr-only">
        {t('problems.due.label')}
      </Label>
      <Input
        id={fieldId}
        type="date"
        className="h-11 w-fit"
        min={range.min}
        max={range.max}
        value={day}
        aria-describedby={hintId}
        onChange={(event) => setDay(event.target.value)}
      />
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('problems.due.hint')}
      </p>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-11" disabled={save.isPending || day === ''}>
          {t('problems.due.save')}
        </Button>
        {problem.due_on === null ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={save.isPending}
            onClick={() => send(null)}
          >
            {t('problems.due.clear')}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={save.isPending}
          onClick={onDone}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
