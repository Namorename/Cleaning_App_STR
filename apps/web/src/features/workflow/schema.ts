import { z } from 'zod';

/**
 * The processes a manager can build.
 *
 * All four values of the `workflow_scope` column, listed in the order the
 * enum itself declares them (20260905110000) so the two cannot drift apart.
 *
 * The panel used to offer only `cleaning` and `problem`. That left a silent
 * gap: the task form has always been able to create a `midstay` or an
 * `inspection` (`TASK_TYPES` in `features/tasks/schema.ts`), and
 * `workflow_scope_for()` has always mapped them to a scope of their own — so
 * such a task reached the cleaner with no steps at all and nothing on any
 * screen explained why.
 */
export const WORKFLOW_SCOPES = ['cleaning', 'midstay', 'problem', 'inspection'] as const;
export type WorkflowScope = (typeof WORKFLOW_SCOPES)[number];

/**
 * Every step type the enum has, in the order a process tends to run.
 *
 * A template may legitimately hold a type the app cannot run yet — the table
 * allows it as long as the step is optional — so the editor has to be able to
 * read one, show it and move it. It just never offers to add one.
 */
export const STEP_TYPES = [
  'photos_before',
  'checklist',
  'inventory',
  'special_requests',
  'photos_after',
  'video',
  'task_note',
  'confirmation',
  'cleaner_comment',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

/**
 * What the app can actually complete today.
 *
 * Mirrors `workflow_supported_step_types()` in the database, whose latest
 * version is in `20260907160100_task_media.sql`. The two lists have to agree:
 * the table refuses `required` on a type outside the server's list, and this
 * one decides what the "add step" menu offers. When a phase brings a type to
 * life, both change.
 */
export const STEP_CATALOGUE = [
  'photos_before',
  'checklist',
  'photos_after',
  'video',
  'task_note',
  'confirmation',
  'cleaner_comment',
] as const satisfies readonly StepType[];

export function isLiveStep(type: StepType): boolean {
  return (STEP_CATALOGUE as readonly StepType[]).includes(type);
}

export function isPhotoStep(type: StepType): boolean {
  return type === 'photos_before' || type === 'photos_after';
}

export function isVideoStep(type: StepType): boolean {
  return type === 'video';
}

/**
 * What the server puts in when a step names no limit of its own.
 *
 * `task_media_max_photos()` and `task_media_max_video_sec()`, plus the one
 * photo `complete_task_step` insists on. Named here so the editor can tell
 * the manager what an empty box means rather than leaving her to guess.
 */
export const DEFAULT_MIN_PHOTOS = 1;
export const DEFAULT_MAX_PHOTOS = 10;
export const DEFAULT_MAX_VIDEO_SEC = 30;

/** The bounds the table itself enforces. */
export const MIN_PHOTOS_FLOOR = 0;
export const MAX_PHOTOS_FLOOR = 1;
export const VIDEO_SEC_FLOOR = 1;
export const VIDEO_SEC_CEILING = 600;

// ---------------------------------------------------------------------------
//  What the server hands back
// ---------------------------------------------------------------------------

/**
 * A template row.
 *
 * `scope` is read as a plain string rather than narrowed to the enum the
 * panel knows. The column is the source of truth, and a fifth value added
 * there later must not turn a row nobody asked for into a blank screen.
 */
export const workflowTemplateSchema = z.object({
  id: z.string(),
  scope: z.string(),
  property_id: z.number().nullable(),
  name: z.string(),
  is_active: z.boolean(),
  version: z.number(),
});
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

export const workflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(STEP_TYPES),
  required: z.boolean(),
  title: z.string().nullable(),
  instructions: z.string().nullable(),
  min_photos: z.number().nullable(),
  max_photos: z.number().nullable(),
  max_video_sec: z.number().nullable(),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export const workflowStepListSchema = z.array(workflowStepSchema);

/** The template that applies here, wherever it turned out to come from. */
export interface ProcessSource {
  template: WorkflowTemplate | null;
  steps: WorkflowStep[];
}

// ---------------------------------------------------------------------------
//  What the editor holds
// ---------------------------------------------------------------------------

/**
 * One step as the editor holds it.
 *
 * Wording is a string rather than `string | null` — an input has no null —
 * and blank means "let the app name this step in the reader's language",
 * which is what the payload turns it back into. Limits stay nullable: an
 * empty box is the server's default, not zero.
 */
export interface StepDraft {
  /** Absent on a step the editor has just invented. */
  id?: string;
  type: StepType;
  required: boolean;
  title: string;
  instructions: string;
  minPhotos: number | null;
  maxPhotos: number | null;
  maxVideoSec: number | null;
}

export interface ProcessDraft {
  /** Absent until this scope and listing have a template of their own. */
  id?: string;
  scope: WorkflowScope;
  propertyId: number | null;
  name: string;
  isActive: boolean;
  steps: StepDraft[];
}

export type ProcessProblem =
  | 'blankName'
  | 'photoRangeInvalid'
  | 'photoMaxInvalid'
  | 'videoLengthInvalid'
  | 'requiredNotSupported';

function stepDraftFrom(row: WorkflowStep, keepId: boolean): StepDraft {
  return {
    ...(keepId ? { id: row.id } : {}),
    type: row.type,
    required: row.required,
    title: row.title ?? '',
    instructions: row.instructions ?? '',
    minPhotos: row.min_photos,
    maxPhotos: row.max_photos,
    maxVideoSec: row.max_video_sec,
  };
}

/**
 * Open a process in the editor.
 *
 * The subtle case is a listing that has no process of its own. What applies
 * to it is somebody else's template — its parent's, or the company default —
 * and those rows must not be edited from here: a manager who meant to adjust
 * one flat would be rewriting the process of all seventy-eight. So the steps
 * are shown, because starting from a blank page is worse, but they come
 * across as a copy: no template id, no step ids, and the first save creates
 * this listing's own template through the natural key.
 */
export function processDraftFrom(
  source: ProcessSource,
  scope: WorkflowScope,
  propertyId: number | null,
): ProcessDraft {
  const own = source.template !== null && source.template.property_id === propertyId
    ? source.template
    : null;

  return {
    ...(own === null ? {} : { id: own.id }),
    scope,
    propertyId,
    name: source.template?.name ?? '',
    isActive: own === null ? true : own.is_active,
    steps: source.steps.map((row) => stepDraftFrom(row, own !== null)),
  };
}

/** A blank step of this type, with every limit left to the server. */
export function emptyStep(type: StepType): StepDraft {
  return {
    type,
    required: false,
    title: '',
    instructions: '',
    minPhotos: null,
    maxPhotos: null,
    maxVideoSec: null,
  };
}

function photoProblem(step: StepDraft): ProcessProblem | null {
  if (step.maxPhotos !== null && step.maxPhotos < MAX_PHOTOS_FLOOR) {
    return 'photoMaxInvalid';
  }
  if (step.minPhotos !== null && step.minPhotos < MIN_PHOTOS_FLOOR) {
    return 'photoRangeInvalid';
  }
  if (step.minPhotos !== null && step.maxPhotos !== null && step.minPhotos > step.maxPhotos) {
    return 'photoRangeInvalid';
  }
  return null;
}

/**
 * What the table would refuse, said in words a manager can act on.
 *
 * Every rule here is also a CHECK on `workflow_steps`, and that is the point:
 * the constraint is the truth, this is the same truth arriving before the
 * save instead of as a wall of Postgres afterwards.
 */
export function processProblem(draft: ProcessDraft): ProcessProblem | null {
  if (draft.name.trim() === '') {
    return 'blankName';
  }

  for (const step of draft.steps) {
    if (step.required && !isLiveStep(step.type)) {
      return 'requiredNotSupported';
    }
    if (isPhotoStep(step.type)) {
      const problem = photoProblem(step);
      if (problem !== null) {
        return problem;
      }
    }
    if (
      isVideoStep(step.type) &&
      step.maxVideoSec !== null &&
      (step.maxVideoSec < VIDEO_SEC_FLOOR || step.maxVideoSec > VIDEO_SEC_CEILING)
    ) {
      return 'videoLengthInvalid';
    }
  }

  return null;
}

function blankToNull(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The whole process in the shape `save_workflow_template` reads.
 *
 * Order is the array order — `sort_order` is written from the position, not
 * carried in the payload. Limits are cleared for a step type that cannot hold
 * them, because a number left behind by an earlier edit would be refused by
 * the table with nothing on screen to explain it.
 *
 * Translations are deliberately absent. The RPC keeps `title_i18n` and
 * `instructions_i18n` as they are when the payload does not mention them, so
 * a manager typing in the company language cannot wipe the Czech wording of
 * a step she did not translate.
 */
export function processPayload(draft: ProcessDraft): Record<string, unknown> {
  return {
    ...(draft.id === undefined ? {} : { id: draft.id }),
    scope: draft.scope,
    property_id: draft.propertyId,
    name: draft.name.trim(),
    is_active: draft.isActive,
    steps: draft.steps.map((step) => ({
      ...(step.id === undefined ? {} : { id: step.id }),
      type: step.type,
      required: step.required,
      title: blankToNull(step.title),
      instructions: blankToNull(step.instructions),
      min_photos: isPhotoStep(step.type) ? step.minPhotos : null,
      max_photos: isPhotoStep(step.type) ? step.maxPhotos : null,
      max_video_sec: isVideoStep(step.type) ? step.maxVideoSec : null,
    })),
  };
}
