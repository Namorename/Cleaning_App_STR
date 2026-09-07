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
  'checklist',
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
  title_i18n: z.record(z.string(), z.string()).catch({}).default({}),
  instructions: z.string().nullable(),
  instructions_i18n: z.record(z.string(), z.string()).catch({}).default({}),
  config: z.record(z.string(), z.unknown()),
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

/**
 * The checklist a task took a copy of when it started.
 *
 * Mirrors `property_checklist_snapshot()` in the database: modules in order,
 * each with the items inside it, each item saying whether it may be left
 * unticked. The ids travel with the snapshot because the answer is made of
 * them — and because an item renamed or deleted afterwards must not turn a
 * finished checklist into a puzzle.
 */
/**
 * A title with its translations.
 *
 * The manager writes a name once, in the company's own language, and F10 will
 * let her add it in the others. Unreadable translations are dropped rather
 * than thrown: one bad key must not cost the cleaner the whole checklist.
 */
const localizedTitleFields = {
  title: z.string(),
  title_i18n: z.record(z.string(), z.string()).catch({}).default({}),
};

export const checklistItemSchema = z.object({
  id: z.string(),
  ...localizedTitleFields,
  is_optional: z.boolean(),
});

export const checklistModuleSchema = z.object({
  id: z.string(),
  ...localizedTitleFields,
  items: z.array(checklistItemSchema),
});

export const checklistConfigSchema = z.object({
  modules: z.array(checklistModuleSchema),
});

export type ChecklistItemView = z.infer<typeof checklistItemSchema>;
export type ChecklistModuleView = z.infer<typeof checklistModuleSchema>;

/** The modules of a checklist step; a config it cannot read shows as none. */
export function checklistModules(step: TaskStep): ChecklistModuleView[] {
  const parsed = checklistConfigSchema.safeParse(step.config);
  return parsed.success ? parsed.data.modules : [];
}

/**
 * Text in the language of whoever is reading it.
 *
 * No translation for her language means the manager's own words: a company
 * that never translates anything reads exactly as it does today, and a half
 * translated checklist shows the translated half. The pair is the shape the
 * database stores everything a manager types in (see 20260907110000).
 */
export function localizedText(
  text: string,
  translations: Readonly<Record<string, string>>,
  language: string,
): string {
  const translated = translations[language];
  return translated !== undefined && translated.trim() !== '' ? translated : text;
}

/** The same, for a checklist module or item. */
export function localizedTitle(
  node: Pick<ChecklistItemView, 'title' | 'title_i18n'>,
  language: string,
): string {
  return localizedText(node.title, node.title_i18n, language);
}

export const checklistPayloadSchema = z.object({
  checked_item_ids: z.array(z.string()),
});

/** The items ticked so far, kept as a draft when the step is reopened. */
export function checkedItemIds(step: TaskStep): string[] {
  const parsed = checklistPayloadSchema.safeParse(step.payload);
  return parsed.success ? parsed.data.checked_item_ids : [];
}

/**
 * Items that still hold the step.
 *
 * The rule the database applies when it validates the answer: an item that is
 * not optional has to be ticked. Optional ones never hold anything, which is
 * what makes them optional.
 */
export function remainingChecklistItems(
  modules: readonly ChecklistModuleView[],
  checked: readonly string[],
): number {
  return modules
    .flatMap((checklistModule) => checklistModule.items)
    .filter((item) => !item.is_optional && !checked.includes(item.id)).length;
}
