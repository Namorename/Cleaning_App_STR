'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { todayIso } from '@/lib/format-date';
import { serverErrorHint, serverErrorText } from '@/lib/server-error';

import {
  draftFromTask,
  isAssigneeMissing,
  isDraftReady,
  isManualTask,
  needsAssignee,
  propertyOptions,
  TASK_TYPES,
  type Task,
  type TaskDraft,
} from './schema';
import { TaskDeparture } from './task-departure';
import { useProperties, useSaveTask, useStaff } from './use-tasks';

/** The key the server sends back when a job of this kind is already on that day. */
const DUPLICATE_HINT = 'serverErrors.taskDuplicate';

/** Ties the executor field to the sentence that says why it cannot stay empty. */
const ASSIGNEE_ERROR_ID = 'task-assignee-error';

/** Ties the time fields of a booking's cleaning to the sentence that says why they are fixed. */
const WINDOW_HINT_ID = 'task-window-hint';

/** A field shown for reading only: set apart from the ones the manager can change. */
const READ_ONLY_CLASS = 'bg-muted';

/**
 * The window of a booking's cleaning is the server's (20260926160000): from
 * the listing's check-out to the next check-in, on whatever day it stands,
 * moved or not. A move writes it for the new day, every generator run
 * rewrites it, and a save that keeps the day keeps it whatever times it sends
 * (20260927120000) — times typed here would not hold.
 */
function hasServerWindow(task: Task | null): boolean {
  return task !== null && task.reservation_id !== null && task.type === 'cleaning';
}

interface TaskFormProps {
  /** The task being changed, or null for a new one. */
  task: Task | null;
  /** Where a new task starts: the calendar opens one on a listing and a day. */
  initial?: Pick<TaskDraft, 'propertyId' | 'scheduledDate'>;
  onClose: () => void;
}

/** A blank draft with its id already minted, so a retry after a lost connection replays. */
function emptyDraft(): TaskDraft {
  return {
    id: crypto.randomUUID(),
    propertyId: null,
    type: 'cleaning',
    scheduledDate: todayIso(),
    title: '',
    assigneeId: null,
    timeFrom: null,
    timeTo: null,
    notes: '',
    expectedDate: null,
  };
}

/**
 * Write a task, or change one.
 *
 * The same dialog does both: the fields are the same, and a wizard that asks
 * the same six questions in three steps only makes the manager click more.
 * A task that came from a booking or a report keeps its listing and its kind
 * — the server refuses to move those, and the form says so rather than
 * offering a choice that will not take.
 *
 * Mounted only while it is open, so every opening starts on a clean draft
 * with an id of its own, without an effect to reset one.
 */
export function TaskForm({ task, initial, onClose }: TaskFormProps) {
  const { t } = useTranslation();
  const properties = useProperties();
  const staff = useStaff();
  const save = useSaveTask();
  const [draft, setDraft] = useState<TaskDraft>(() =>
    task === null ? { ...emptyDraft(), ...initial } : draftFromTask(task),
  );
  // Sorted and composed once per list, not once per keystroke in the notes.
  const places = useMemo(() => propertyOptions(properties.data ?? []), [properties.data]);

  // Active colleagues only; undefined until the list arrives.
  const activeStaff = useMemo(() => staff.data?.map((person) => person.id), [staff.data]);

  const isGenerated = task !== null && !isManualTask(task);
  const isWindowFixed = hasServerWindow(task);
  const windowFieldProps = isWindowFixed
    ? { readOnly: true, className: READ_ONLY_CLASS, 'aria-describedby': WINDOW_HINT_ID }
    : {};
  const isReady = isDraftReady(draft, activeStaff);
  const isAssigneeRequired = needsAssignee(draft.type);
  const hasAssigneeGap = isAssigneeMissing(draft, activeStaff);
  // An executor the list does not offer — switched off since, or the list is
  // still on its way — gets an option of their own. Without it the select
  // matches nothing, and a browser shows the first option it may pick: on an
  // inspection, where "nobody" is disabled, a colleague who was never asked.
  const offListAssignee =
    draft.assigneeId !== null && !(activeStaff ?? []).includes(draft.assigneeId)
      ? draft.assigneeId
      : null;
  const offListName =
    (offListAssignee !== null && offListAssignee === task?.assignee_id
      ? task.assignee?.full_name
      : null) ?? offListAssignee;
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isDuplicate = save.isError && serverErrorHint(save.error) === DUPLICATE_HINT;

  // The disabled button is what the manager sees; the handlers ask the same
  // question, so a submit that reaches the form some other way sends nothing.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isReady) {
      return;
    }
    save.mutate({ draft }, { onSuccess: onClose });
  };
  const confirmDuplicate = () => {
    if (!isReady) {
      return;
    }
    save.mutate({ draft, allowDuplicate: true }, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {task === null ? t('panel.tasks.form.titleNew') : t('panel.tasks.form.titleEdit')}
          </DialogTitle>
          <DialogDescription>{t('panel.tasks.form.description')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="task-property">{t('panel.tasks.form.property')}</Label>
              <NativeSelect
                id="task-property"
                value={draft.propertyId ?? ''}
                disabled={isGenerated}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    propertyId: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">{t('panel.tasks.form.propertyPlaceholder')}</option>
                {places.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="task-type">{t('panel.tasks.form.type')}</Label>
              <NativeSelect
                id="task-type"
                value={draft.type}
                disabled={isGenerated}
                onChange={(event) =>
                  setDraft({ ...draft, type: event.target.value as TaskDraft['type'] })
                }
              >
                {TASK_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`panel.tasks.types.${type}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {isGenerated ? (
            <p className="text-xs text-muted-foreground">{t('panel.tasks.form.generatedHint')}</p>
          ) : null}

          {task !== null && task.reservation_id !== null ? (
            <TaskDeparture reservationId={task.reservation_id} />
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="task-title">{t('panel.tasks.form.name')}</Label>
            <Input
              id="task-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="task-date">{t('panel.tasks.form.date')}</Label>
                <Input
                  id="task-date"
                  type="date"
                  value={draft.scheduledDate}
                  onChange={(event) => setDraft({ ...draft, scheduledDate: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="task-from">{t('panel.tasks.form.timeFrom')}</Label>
                <Input
                  id="task-from"
                  type="time"
                  value={draft.timeFrom ?? ''}
                  {...windowFieldProps}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      timeFrom: event.target.value === '' ? null : event.target.value,
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="task-to">{t('panel.tasks.form.timeTo')}</Label>
                <Input
                  id="task-to"
                  type="time"
                  value={draft.timeTo ?? ''}
                  {...windowFieldProps}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      timeTo: event.target.value === '' ? null : event.target.value,
                    })
                  }
                />
              </div>
            </div>
            {isWindowFixed ? (
              <p id={WINDOW_HINT_ID} className="text-xs text-muted-foreground">
                {t('panel.tasks.form.windowFromBooking')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="task-assignee">{t('panel.tasks.form.assignee')}</Label>
            <NativeSelect
              id="task-assignee"
              value={draft.assigneeId ?? ''}
              aria-invalid={hasAssigneeGap}
              aria-describedby={hasAssigneeGap ? ASSIGNEE_ERROR_ID : undefined}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  assigneeId: event.target.value === '' ? null : event.target.value,
                })
              }
            >
              {/* Listed even when it cannot be picked: a job with nobody yet shows it chosen. */}
              <option value="" disabled={isAssigneeRequired}>
                {t('panel.tasks.form.assigneeNobody')}
              </option>
              {offListAssignee !== null ? (
                <option value={offListAssignee} disabled={staff.data !== undefined}>
                  {staff.data === undefined
                    ? offListName
                    : t('panel.tasks.form.assigneeInactive', { name: offListName })}
                </option>
              ) : null}
              {(staff.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name ?? person.id}
                </option>
              ))}
            </NativeSelect>
            {hasAssigneeGap ? (
              <p id={ASSIGNEE_ERROR_ID} role="alert" className="text-xs text-destructive">
                {t('panel.tasks.form.assigneeRequired')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="task-notes">{t('panel.tasks.form.notes')}</Label>
            <Textarea
              id="task-notes"
              rows={3}
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>

          {failure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {failure.text}
              {failure.detail === null ? null : (
                <span className="block text-xs text-muted-foreground">{failure.detail}</span>
              )}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('panel.tasks.form.close')}
            </Button>
            {isDuplicate ? (
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending || !isReady}
                onClick={confirmDuplicate}
              >
                {/* An edit creates nothing: it is the move that is confirmed. */}
                {task === null
                  ? t('panel.tasks.form.duplicate')
                  : t('panel.tasks.form.duplicateSave')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.isPending || !isReady}>
              {save.isPending ? t('panel.tasks.form.saving') : t('panel.tasks.form.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
