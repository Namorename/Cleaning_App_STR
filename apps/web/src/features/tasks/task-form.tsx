'use client';

import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES } from '@str-ops/shared';
import { useState, type FormEvent } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { todayIso } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';

import {
  draftFromTask,
  isDraftReady,
  isManualTask,
  TASK_TYPES,
  type Task,
  type TaskDraft,
} from './schema';
import { useCompanyLanguage, useProperties, useSaveTask, useStaff } from './use-tasks';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

/** The key the server sends back when a job of this kind is already on that day. */
const DUPLICATE_HINT = 'serverErrors.taskDuplicate';

interface TaskFormProps {
  /** The task being changed, or null for a new one. */
  task: Task | null;
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
    titleI18n: {},
    assigneeId: null,
    timeFrom: null,
    timeTo: null,
    notes: '',
  };
}

function hintOf(error: unknown): string | null {
  const hint = (error as { hint?: unknown } | null)?.hint;
  return typeof hint === 'string' ? hint : null;
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
export function TaskForm({ task, onClose }: TaskFormProps) {
  const { t } = useTranslation();
  const properties = useProperties();
  const staff = useStaff();
  const companyLanguage = useCompanyLanguage();
  const save = useSaveTask();
  const [draft, setDraft] = useState<TaskDraft>(() =>
    task === null ? emptyDraft() : draftFromTask(task),
  );

  const language = companyLanguage.data ?? FALLBACK_LANGUAGE;
  const otherLanguages = SUPPORTED_LANGUAGES.filter((code) => code !== language);
  const isGenerated = task !== null && !isManualTask(task);
  const failure = save.isError ? serverErrorText(save.error) : null;
  const isDuplicate = save.isError && hintOf(save.error) === DUPLICATE_HINT;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate({ draft }, { onSuccess: onClose });
  };
  const confirmDuplicate = () =>
    save.mutate({ draft, allowDuplicate: true }, { onSuccess: onClose });
  const setTranslation = (code: string, text: string) =>
    setDraft((current) => ({ ...current, titleI18n: { ...current.titleI18n, [code]: text } }));

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
              <select
                id="task-property"
                className={SELECT_CLASS}
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
                {(properties.data ?? []).map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="task-type">{t('panel.tasks.form.type')}</Label>
              <select
                id="task-type"
                className={SELECT_CLASS}
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
              </select>
            </div>
          </div>

          {isGenerated ? (
            <p className="text-xs text-muted-foreground">{t('panel.tasks.form.generatedHint')}</p>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="task-title">
              {t('panel.tasks.form.name', {
                language: t(`panel.tasks.form.languages.${language}`),
              })}
            </Label>
            <Input
              id="task-title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {otherLanguages.map((code) => (
              <div key={code} className="flex flex-col gap-1">
                <Label htmlFor={`task-title-${code}`}>
                  {t('panel.tasks.form.translation', {
                    language: t(`panel.tasks.form.languages.${code}`),
                  })}
                </Label>
                <Input
                  id={`task-title-${code}`}
                  value={draft.titleI18n[code] ?? ''}
                  onChange={(event) => setTranslation(code, event.target.value)}
                />
              </div>
            ))}
          </div>

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
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    timeTo: event.target.value === '' ? null : event.target.value,
                  })
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="task-assignee">{t('panel.tasks.form.assignee')}</Label>
            <select
              id="task-assignee"
              className={SELECT_CLASS}
              value={draft.assigneeId ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  assigneeId: event.target.value === '' ? null : event.target.value,
                })
              }
            >
              <option value="">{t('panel.tasks.form.assigneeNobody')}</option>
              {(staff.data ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name ?? person.id}
                </option>
              ))}
            </select>
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
                disabled={save.isPending}
                onClick={confirmDuplicate}
              >
                {t('panel.tasks.form.duplicate')}
              </Button>
            ) : null}
            <Button type="submit" disabled={save.isPending || !isDraftReady(draft)}>
              {save.isPending ? t('panel.tasks.form.saving') : t('panel.tasks.form.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
