'use client';

import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { isLiveStep, isPhotoStep, isVideoStep, type StepDraft } from './schema';

/** An empty box is the server's default, not a zero. */
function toLimit(raw: string): number | null {
  if (raw.trim() === '') {
    return null;
  }
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

interface StepRowProps {
  step: StepDraft;
  /** Zero-based; everything the manager reads counts from one. */
  at: number;
  onChange: (next: StepDraft) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

/**
 * One step of the process, with the settings that belong to its type.
 *
 * The type is fixed once a step exists. Changing it in place would silently
 * change what the step collects while keeping the wording written for the old
 * one; removing the step and adding the right one says the same thing out
 * loud. Limits appear only where the table allows them — photo counts on a
 * photo step, seconds on a video step — because a box whose value the
 * database would refuse is worse than no box.
 */
export function StepRow({ step, at, onChange, onMove, onRemove }: StepRowProps) {
  const { t } = useTranslation();
  const id = useId();
  const number = at + 1;
  const supported = isLiveStep(step.type);
  const stepLabel = t('panel.settings.workflow.stepNumber', { at: number });

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {stepLabel} · {t(`panel.settings.workflow.stepTypes.${step.type}`)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('panel.settings.workflow.stepUp', { at: number })}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t('panel.settings.workflow.stepDown', { at: number })}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('panel.settings.workflow.removeStep', { at: number })}
            onClick={onRemove}
          >
            ✕
          </Button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={step.required}
          disabled={!supported}
          onChange={(event) => onChange({ ...step, required: event.target.checked })}
        />
        {t('panel.settings.workflow.required')}
      </label>
      {supported ? null : (
        <p className="text-xs text-muted-foreground">{t('panel.settings.workflow.notSupported')}</p>
      )}

      <LabelledField id={`${id}-title`} label={t('panel.settings.workflow.stepTitle')}>
        <Input
          id={`${id}-title`}
          aria-label={`${t('panel.settings.workflow.stepTitle')} — ${stepLabel}`}
          placeholder={t('panel.settings.workflow.stepTitlePlaceholder')}
          value={step.title}
          onChange={(event) => onChange({ ...step, title: event.target.value })}
        />
      </LabelledField>

      <LabelledField id={`${id}-instructions`} label={t('panel.settings.workflow.instructions')}>
        <Textarea
          id={`${id}-instructions`}
          aria-label={`${t('panel.settings.workflow.instructions')} — ${stepLabel}`}
          rows={2}
          value={step.instructions}
          onChange={(event) => onChange({ ...step, instructions: event.target.value })}
        />
      </LabelledField>

      {isPhotoStep(step.type) ? (
        <div className="flex flex-wrap gap-2">
          <LabelledField id={`${id}-min`} label={t('panel.settings.workflow.minPhotos')}>
            <Input
              id={`${id}-min`}
              type="number"
              min={0}
              className="w-24"
              aria-label={`${t('panel.settings.workflow.minPhotos')} — ${stepLabel}`}
              value={step.minPhotos ?? ''}
              onChange={(event) => onChange({ ...step, minPhotos: toLimit(event.target.value) })}
            />
          </LabelledField>
          <LabelledField id={`${id}-max`} label={t('panel.settings.workflow.maxPhotos')}>
            <Input
              id={`${id}-max`}
              type="number"
              min={1}
              className="w-24"
              aria-label={`${t('panel.settings.workflow.maxPhotos')} — ${stepLabel}`}
              value={step.maxPhotos ?? ''}
              onChange={(event) => onChange({ ...step, maxPhotos: toLimit(event.target.value) })}
            />
          </LabelledField>
        </div>
      ) : null}

      {isVideoStep(step.type) ? (
        <LabelledField id={`${id}-video`} label={t('panel.settings.workflow.maxVideoSec')}>
          <Input
            id={`${id}-video`}
            type="number"
            min={1}
            className="w-32"
            aria-label={`${t('panel.settings.workflow.maxVideoSec')} — ${stepLabel}`}
            value={step.maxVideoSec ?? ''}
            onChange={(event) => onChange({ ...step, maxVideoSec: toLimit(event.target.value) })}
          />
        </LabelledField>
      ) : null}
    </li>
  );
}
