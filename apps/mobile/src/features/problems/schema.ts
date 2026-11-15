import { z } from 'zod';

import type { ProblemCategory } from './categories';
import { closingFields } from './closing';
import { shownTitle, signalSourceFields } from './signal-source';

export const PROBLEM_PRIORITIES = ['low', 'normal', 'high'] as const;
export type ProblemPriority = (typeof PROBLEM_PRIORITIES)[number];

export const PROBLEM_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'cancelled',
] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** The same numbers the database checks (problem_*_max_length, problem_max_photos). */
export const MAX_PROBLEM_TITLE = 200;
export const MAX_PROBLEM_DESCRIPTION = 4000;
export const MAX_PROBLEM_PHOTOS = 4;

/**
 * A problem as the app reads it. The listing name rides along from the join;
 * a row straight from an RPC has no join, so it is optional.
 */
export const problemSchema = z.object({
  id: z.string().uuid(),
  property_id: z.number().nullable(),
  task_id: z.string().uuid().nullable(),
  // Null for a task found in a guest review: nobody on the staff reported it
  // (docs/reviews-to-tasks.md §2.5), and so nobody may edit it as its reporter.
  reported_by: z.string().uuid().nullable(),
  title: z.string(),
  // A task from a guest review or message (signal-source.ts): absent while its
  // switch is off, and from a phone's saved copy of an older build.
  ...signalSourceFields,
  description: z.string().nullable(),
  priority: z.enum(PROBLEM_PRIORITIES),
  // The category it was filed under (20261115100000); null when its title was
  // typed. Absent from a copy an older build saved on the phone.
  category_id: z.string().uuid().nullable().catch(null).optional(),
  status: z.enum(PROBLEM_STATUSES),
  resolved_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  // Who did the work and who closed it, with the names (closing.ts).
  ...closingFields,
  created_at: z.string(),
  // `name` is `text not null` on the table and has always been in the
  // select, so the old `.nullable()` was never real — and the shared
  // labeller needs a string. The house rides along: a report filed from a
  // task stands on the room, whose own name names no house.
  property: z
    .object({
      name: z.string(),
      hostaway_unit_id: z.number().nullable().default(null),
      parent: z.object({ name: z.string() }).nullable().default(null),
    })
    .nullable()
    .optional(),
  // The fix tasks the reader may see — for a technician, her own.
  fix_tasks: z
    .array(
      z.object({
        id: z.string().uuid(),
        assignee_id: z.string().uuid().nullable(),
        status: z.string(),
      }),
    )
    .default([]),
});

export type Problem = z.infer<typeof problemSchema>;

/** The live fix task that is the reader's own, if any. */
export function ownFixTaskId(problem: Problem, userId: string | null): string | null {
  return (
    problem.fix_tasks.find(
      (task) =>
        task.assignee_id === userId && task.status !== 'cancelled' && task.status !== 'expired',
    )?.id ?? null
  );
}
export const problemListSchema = z.array(problemSchema);

/** What the form holds before it becomes a row. */
export interface ProblemDraft {
  /** Typed by her, or the name of the category she picked. */
  title: string;
  description: string;
  /** Chosen by her, or the category's: then only shown, never hers to change. */
  priority: ProblemPriority;
  /** The category she picked from the company's catalogue; null while she types a title. */
  categoryId: string | null;
}

export const EMPTY_PROBLEM_DRAFT: ProblemDraft = {
  title: '',
  description: '',
  priority: 'normal',
  categoryId: null,
};

export type ProblemDraftIssue =
  'titleRequired' | 'titleTooLong' | 'descriptionTooLong' | 'categoryRequired';

/**
 * Does the form ask for a category rather than a title?
 *
 * Yes once she has one, and while the catalogue is on the phone and the title is
 * not hers. `titleIsHers` is set by the form for good the moment she types into
 * the title, and from the start for a report with a typed title she corrects: a
 * catalogue that arrives late — a slow first read — never takes her form away,
 * not even when she empties the field to type it again. No catalogue (the company
 * types titles, she is not a cleaner, or it never reached this phone): the typed
 * title, as before.
 */
export function asksForCategory(
  draft: ProblemDraft,
  categories: readonly ProblemCategory[] | null,
  titleIsHers: boolean,
): boolean {
  return draft.categoryId !== null || (categories !== null && !titleIsHers);
}

/** A draft whose title she typed: a report she corrects that was not filed under a category. */
export function hasTypedTitle(draft: ProblemDraft): boolean {
  return draft.categoryId === null && draft.title.trim() !== '';
}

/**
 * Why the draft cannot be sent yet, mirroring the server's refusals, or null.
 * A form that asks for a category needs one and no title: the category is it.
 */
export function problemDraftIssue(
  draft: ProblemDraft,
  byCategory = false,
): ProblemDraftIssue | null {
  if (byCategory) {
    if (draft.categoryId === null) {
      return 'categoryRequired';
    }
  } else if (draft.title.trim() === '') {
    return 'titleRequired';
  } else if (draft.title.trim().length > MAX_PROBLEM_TITLE) {
    return 'titleTooLong';
  }
  if (draft.description.length > MAX_PROBLEM_DESCRIPTION) {
    return 'descriptionTooLong';
  }
  return null;
}

/** A category picked: its name in her language and its urgency, as she will see them. */
export function draftWithCategory(
  draft: ProblemDraft,
  category: ProblemCategory,
  name: string,
): ProblemDraft {
  return {
    ...draft,
    categoryId: category.id,
    title: name,
    priority: category.priority ?? draft.priority,
  };
}

/**
 * The form's draft of a report she corrects. A report filed under a category
 * shows the category's name in her language (its title's translations, when
 * the reader's language is given); a typed title stays as she typed it.
 */
export function draftOfProblem(problem: Problem, language?: string): ProblemDraft {
  const categoryId = problem.category_id ?? null;
  return {
    title:
      categoryId !== null && language !== undefined ? shownTitle(problem, language) : problem.title,
    description: problem.description ?? '',
    priority: problem.priority,
    categoryId,
  };
}

/** The reporter may change the report until somebody picks it up. */
export function canEditProblem(problem: Problem, userId: string | null): boolean {
  return problem.status === 'open' && problem.reported_by === userId;
}

export function isProblemClosed(problem: Problem): boolean {
  return problem.status === 'resolved' || problem.status === 'cancelled';
}

export interface ProblemGroup {
  key: 'active' | 'closed';
  data: Problem[];
}

/** Live reports first, closed ones below, each newest first as the server sends them. */
export function groupProblems(problems: readonly Problem[]): ProblemGroup[] {
  const active = problems.filter((problem) => !isProblemClosed(problem));
  const closed = problems.filter(isProblemClosed);

  return [
    ...(active.length > 0 ? [{ key: 'active' as const, data: active }] : []),
    ...(closed.length > 0 ? [{ key: 'closed' as const, data: closed }] : []),
  ];
}
