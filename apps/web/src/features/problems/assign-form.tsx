'use client';

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { serverErrorText } from '@/lib/server-error';

import { formatClock, todayIso } from './format';
import type { FixTask, Problem } from './schema';
import { useAssignProblem, useStaff } from './use-problems';

interface AssignFormProps {
  problem: Problem;
  /** The attempt being moved, if any; the form starts from its values. */
  fixTask: FixTask | null;
  /** Called once the server has taken the assignment; a dialog closes on it. */
  onAssigned?: () => void;
}

/** Who fixes it, when, and in what window. Native controls: the browser knows dates. */
export function AssignForm({ problem, fixTask, onAssigned }: AssignFormProps) {
  const { t } = useTranslation();
  const staff = useStaff();
  const assign = useAssignProblem();
  const [assigneeId, setAssigneeId] = useState(fixTask?.assignee_id ?? '');
  const [date, setDate] = useState(fixTask?.scheduled_date ?? todayIso());
  const [timeFrom, setTimeFrom] = useState(
    fixTask?.time_from ? formatClock(fixTask.time_from) : '',
  );
  const [timeTo, setTimeTo] = useState(fixTask?.time_to ? formatClock(fixTask.time_to) : '');

  if (problem.property_id === null) {
    return (
      <p className="text-sm text-muted-foreground">{t('panel.problems.assign.noProperty')}</p>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (assigneeId === '') {
      return;
    }
    assign.mutate(
      {
        problemId: problem.id,
        assigneeId,
        scheduledDate: date === '' ? null : date,
        timeFrom: timeFrom === '' ? null : timeFrom,
        timeTo: timeTo === '' ? null : timeTo,
      },
      { onSuccess: onAssigned },
    );
  };

  const failure = assign.isError ? serverErrorText(assign.error) : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assignee">{t('panel.problems.assign.assignee')}</Label>
        <select
          id="assignee"
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          required
          className="h-9 rounded-md border bg-background px-3 text-sm"
        >
          <option value="">{t('panel.problems.assign.choose')}</option>
          {(staff.data ?? []).map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name ?? t('panel.problems.unknownPerson')}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">{t('panel.problems.assign.date')}</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timeFrom">{t('panel.problems.assign.timeFrom')}</Label>
          <Input
            id="timeFrom"
            type="time"
            value={timeFrom}
            onChange={(e) => setTimeFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timeTo">{t('panel.problems.assign.timeTo')}</Label>
          <Input
            id="timeTo"
            type="time"
            value={timeTo}
            onChange={(e) => setTimeTo(e.target.value)}
          />
        </div>
      </div>
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail !== null ? (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          ) : null}
        </p>
      ) : null}
      {assign.isSuccess ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('panel.problems.assign.done')}
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={assign.isPending || assigneeId === ''}
        className="self-start"
      >
        {fixTask === null ? t('panel.problems.assign.submit') : t('panel.problems.assign.resubmit')}
      </Button>
    </form>
  );
}
