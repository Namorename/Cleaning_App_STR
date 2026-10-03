import { Constants, type StatusKey } from '@str-ops/shared';

import { currentLanguage, i18n } from '@/i18n';

import { localizedText, type StepState, type TaskStep } from './schema';

const KNOWN_STEP_TYPES: readonly string[] = Constants.public.Enums.workflow_step_type;

/**
 * What the step is called on screen.
 *
 * The manager's own wording wins when there is one — in the cleaner's
 * language if it was translated, otherwise as the manager wrote it. With no
 * wording of its own the step is named by the app's translation of its type.
 * A type this build has never heard of gets a neutral word rather than a raw
 * identifier.
 */
export function stepTitle(step: TaskStep): string {
  if (step.title !== null && step.title.trim() !== '') {
    return localizedText(step.title, step.title_i18n, currentLanguage());
  }
  if (KNOWN_STEP_TYPES.includes(step.type)) {
    return i18n.t(`steps.types.${step.type}`);
  }
  return i18n.t('steps.types.unknown');
}

/**
 * What the step tells the cleaner to do, in her language, or nothing.
 *
 * On a note step this is the task's own note, which exists in one language:
 * there is nothing to translate it from, and the fallback returns it as it is.
 */
export function stepInstructions(step: TaskStep): string | null {
  if (step.instructions === null || step.instructions.trim() === '') {
    return null;
  }

  return localizedText(step.instructions, step.instructions_i18n, currentLanguage());
}

export function stepStateText(state: StepState): string {
  return i18n.t(`steps.state.${state}`);
}

/**
 * Where a step stands, as a key of the tone contract (STATUS_TONE): done is
 * green, skipped and waived are "cancelled" grey — not the green of done.
 */
export const STEP_STATUS_KEY = {
  done: 'steps.done',
  skipped: 'steps.skipped',
  waived: 'steps.waived',
  pending: 'steps.pending',
  unsupported: 'steps.unsupported',
} as const satisfies Readonly<Record<StepState, StatusKey>>;
