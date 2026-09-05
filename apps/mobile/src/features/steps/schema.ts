import type { WorkflowStepType } from '@str-ops/shared';
import { z } from 'zod';

/**
 * Step types this build of the app can complete.
 *
 * Mirrors `public.workflow_supported_step_types()` in the database, which is
 * the authority: a step of any other type is refused there whatever this list
 * says. It exists so the app can show such a step as "not in this version"
 * instead of offering a button that is going to be refused.
 */
export const SUPPORTED_STEP_TYPES = [
  'task_note',
  'cleaner_comment',
  'confirmation',
] as const satisfies readonly WorkflowStepType[];

export type SupportedStepType = (typeof SUPPORTED_STEP_TYPES)[number];

export function isSupportedStepType(type: string): type is SupportedStepType {
  return (SUPPORTED_STEP_TYPES as readonly string[]).includes(type);
}

/**
 * One step of a task as the app reads it.
 *
 * `type` is kept as a plain string on purpose: a step type added by a later
 * migration must arrive here as "unsupported", not as a parse failure that
 * takes the whole task screen down with it.
 */
export const taskStepSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  sort_order: z.number().int(),
  type: z.string(),
  required: z.boolean(),
  title: z.string().nullable(),
  instructions: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  completed_by: z.string().uuid().nullable(),
  payload: z.record(z.string(), z.unknown()),
  skipped_at: z.string().nullable(),
  skip_reason: z.string().nullable(),
  waived_at: z.string().nullable(),
  waive_reason: z.string().nullable(),
});

export type TaskStep = z.infer<typeof taskStepSchema>;

export const taskStepListSchema = z.array(taskStepSchema);

export type StepState = 'done' | 'skipped' | 'waived' | 'pending' | 'unsupported';

/** What the step is right now, in the order the screen cares about. */
export function stepState(step: TaskStep): StepState {
  if (step.completed_at !== null) {
    return 'done';
  }
  if (step.waived_at !== null) {
    return 'waived';
  }
  if (step.skipped_at !== null) {
    return 'skipped';
  }
  if (!isSupportedStepType(step.type)) {
    return 'unsupported';
  }
  return 'pending';
}

/**
 * Required steps that still hold the finish.
 *
 * The same rule the database applies in the finish gate; here it only decides
 * whether the button is worth pressing.
 */
export function remainingRequired(steps: readonly TaskStep[]): number {
  return steps.filter(
    (step) => step.required && step.completed_at === null && step.waived_at === null,
  ).length;
}

/**
 * The lines of a note the cleaner ticks one by one.
 *
 * Split on CR/LF, blank lines dropped — exactly as `task_note_line_count()`
 * does in the database, which checks that every index 0..n-1 is ticked. The
 * two are kept together by a shared fixture in both test suites.
 */
export function noteLines(text: string | null): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export const MAX_COMMENT_LENGTH = 4000;

export const taskNotePayloadSchema = z.object({
  checked_lines: z.array(z.number().int().nonnegative()),
});

export const commentPayloadSchema = z.object({
  text: z.string(),
});

/** Ticked line indexes stored so far; an unreadable payload reads as none. */
export function checkedLines(step: TaskStep): number[] {
  const parsed = taskNotePayloadSchema.safeParse(step.payload);
  return parsed.success ? parsed.data.checked_lines : [];
}

/** The comment saved so far, kept as a draft when the step is reopened. */
export function commentText(step: TaskStep): string {
  const parsed = commentPayloadSchema.safeParse(step.payload);
  return parsed.success ? parsed.data.text : '';
}
