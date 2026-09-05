import { Constants } from '@str-ops/shared';

import { i18n } from '@/i18n';

import type { StepState, TaskStep } from './schema';

const KNOWN_STEP_TYPES: readonly string[] = Constants.public.Enums.workflow_step_type;

/**
 * What the step is called on screen.
 *
 * The manager's own wording wins when there is one; otherwise the app's
 * translation of the type, so each cleaner reads it in her own language. A
 * type this build has never heard of gets a neutral word rather than a raw
 * identifier.
 */
export function stepTitle(step: TaskStep): string {
  if (step.title !== null && step.title.trim() !== '') {
    return step.title;
  }
  if (KNOWN_STEP_TYPES.includes(step.type)) {
    return i18n.t(`steps.types.${step.type}`);
  }
  return i18n.t('steps.types.unknown');
}

export function stepStateText(state: StepState): string {
  return i18n.t(`steps.state.${state}`);
}
