'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { moveAt, removeAt, replaceAt } from '@/lib/list';
import { serverErrorText } from '@/lib/server-error';

import {
  DEFAULT_MAX_PHOTOS,
  DEFAULT_MAX_VIDEO_SEC,
  DEFAULT_MIN_PHOTOS,
  STEP_CATALOGUE,
  VIDEO_SEC_CEILING,
  VIDEO_SEC_FLOOR,
  emptyStep,
  processDraftFrom,
  processProblem,
  type ProcessDraft,
  type ProcessSource,
  type StepDraft,
  type StepType,
  type WorkflowScope,
} from './schema';
import { StepRow } from './step-row';
import { useSaveProcess } from './use-workflow';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

interface WorkflowBuilderProps {
  source: ProcessSource;
  scope: WorkflowScope;
  propertyId: number | null;
}

/**
 * The process, as a list a manager can rearrange.
 *
 * The draft starts as null and the server's answer shows through it — the
 * same shape as the checklist editor, and for the same reason: a process
 * that arrives late still appears, and dropping the draft after a save is
 * how the editor picks up the ids the server has just minted for new steps.
 *
 * `is_active` is offered for a listing and not for the company default.
 * Switching off a listing's override sends it back to the shared process,
 * which is a thing a manager wants; switching off the company default would
 * leave every cleaning with no steps at all, which is legal and almost
 * certainly a mistake, so it is not a checkbox on this screen.
 */
export function WorkflowBuilder({ source, scope, propertyId }: WorkflowBuilderProps) {
  const { t } = useTranslation();
  const save = useSaveProcess();

  /** Null until the manager touches it — until then the server's answer shows. */
  const [draft, setDraft] = useState<ProcessDraft | null>(null);
  const [adding, setAdding] = useState<StepType>(STEP_CATALOGUE[0]);

  const process = draft ?? processDraftFrom(source, scope, propertyId);
  const problem = processProblem(process);
  const failure = save.isError ? serverErrorText(save.error) : null;

  const setSteps = (steps: StepDraft[]) => setDraft({ ...process, steps });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('panel.settings.workflow.name')}
        <Input
          value={process.name}
          onChange={(event) => setDraft({ ...process, name: event.target.value })}
        />
      </label>

      {propertyId === null ? null : (
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={process.isActive}
              onChange={(event) => setDraft({ ...process, isActive: event.target.checked })}
            />
            {t('panel.settings.workflow.enabled')}
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            {t('panel.settings.workflow.enabledHint')}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('panel.settings.workflow.hint')}</p>
        <p className="text-xs text-muted-foreground">
          {t('panel.settings.workflow.limitsHint', {
            min: DEFAULT_MIN_PHOTOS,
            max: DEFAULT_MAX_PHOTOS,
            sec: DEFAULT_MAX_VIDEO_SEC,
          })}
        </p>
      </div>

      {process.steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.settings.workflow.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {process.steps.map((step, at) => (
            <StepRow
              key={step.id ?? `new-${at}`}
              step={step}
              at={at}
              onChange={(next) => setSteps(replaceAt(process.steps, at, next))}
              onMove={(direction) => setSteps(moveAt(process.steps, at, direction))}
              onRemove={() => setSteps(removeAt(process.steps, at))}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('panel.settings.workflow.addStep')}
          <select
            className={SELECT_CLASS}
            aria-label={t('panel.settings.workflow.addStep')}
            value={adding}
            onChange={(event) => setAdding(event.target.value as StepType)}
          >
            {STEP_CATALOGUE.map((type) => (
              <option key={type} value={type}>
                {t(`panel.settings.workflow.stepTypes.${type}`)}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          onClick={() => setSteps([...process.steps, emptyStep(adding)])}
        >
          {t('panel.settings.workflow.addStep')}
        </Button>
      </div>

      {/* Only once she has touched something. A scope with no process yet
          opens with a blank name, and greeting her with "a process needs a
          name" before she has typed a character is a complaint about her
          having arrived. The save button is disabled either way, and the
          banner above already says what the screen is for. */}
      {problem === null || draft === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {t(`panel.settings.workflow.problems.${problem}`, {
            floor: VIDEO_SEC_FLOOR,
            ceiling: VIDEO_SEC_CEILING,
          })}
        </p>
      )}

      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{failure.text}</p>
          {failure.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('panel.settings.workflow.runningNote')}</p>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={problem !== null || save.isPending}
          onClick={() => save.mutate(process, { onSuccess: () => setDraft(null) })}
        >
          {save.isPending ? t('panel.settings.saving') : t('panel.settings.workflow.save')}
        </Button>
        {draft === null ? null : (
          <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
            {t('panel.settings.workflow.cancel')}
          </Button>
        )}
        {save.isSuccess && draft === null && !save.isPending ? (
          <span role="status" className="text-sm text-muted-foreground">
            {t('panel.settings.saved')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
