import {
  isQualityTheme,
  PLAN_STEP_ROLES,
  THEME_STEP_KINDS,
  type PlanStepKind,
} from '@str-ops/shared';

import type { PlacePlan, PlaceWork, PlanPriority, PlanStep } from './schema';

/** A step as the editor holds it: what the manager can change, before the server has it. */
export interface DraftStep {
  id: string;
  theme: string;
  kind: PlanStepKind;
  title: string;
  title_i18n: Readonly<Record<string, string>>;
  description: string;
  assignee_id: string | null;
  due_on: string | null;
  priority: PlanPriority;
  linked_problem_id: string | null;
}

/** The words of a proposed step, in the manager's language and the others. */
export type StepWords = (
  kind: PlanStepKind,
  theme: string,
) => { title: string; title_i18n: Readonly<Record<string, string>> };

export function newStep(
  theme: string,
  kind: PlanStepKind,
  words: StepWords,
  makeId: () => string,
): DraftStep {
  return {
    id: makeId(),
    theme,
    kind,
    ...words(kind, theme),
    description: '',
    assignee_id: null,
    due_on: null,
    priority: 'normal',
    linked_problem_id: null,
  };
}

/**
 * What a theme starts with. A repair where a live task already works on the theme leans on it and
 * makes none of its own (§5.4).
 */
export function proposeSteps(
  themes: readonly string[],
  work: readonly PlaceWork[],
  words: StepWords,
  makeId: () => string,
): DraftStep[] {
  return themes.flatMap((theme) => {
    const kinds = isQualityTheme(theme) ? THEME_STEP_KINDS[theme] : (['decision'] as const);
    const live = work.find((item) => item.theme === theme) ?? null;
    return kinds.map((kind) => {
      const step = newStep(theme, kind, words, makeId);
      return kind === 'repair' && live !== null
        ? { ...step, title: live.title, title_i18n: {}, linked_problem_id: live.problem_id }
        : step;
    });
  });
}

export function draftFromStep(step: PlanStep): DraftStep {
  return {
    id: step.id,
    theme: step.theme,
    kind: step.kind,
    title: step.title,
    title_i18n: step.title_i18n,
    description: step.description ?? '',
    assignee_id: step.assignee_id,
    due_on: step.due_on,
    priority: step.priority,
    linked_problem_id: step.linked_problem_id,
  };
}

/** What save_resolution_plan reads. */
export function wireStep(step: DraftStep) {
  return {
    id: step.id,
    theme: step.theme,
    kind: step.kind,
    title: step.title,
    title_i18n: step.title_i18n,
    description: step.description,
    assignee_id: step.assignee_id,
    due_on: step.due_on,
    priority: step.priority,
    linked_problem_id: step.linked_problem_id,
  };
}

export type StepChange = Partial<Omit<DraftStep, 'id' | 'theme'>>;

/**
 * One change to one step. A new title is no longer what its translations said, and a step of
 * another kind can keep neither the person nor the task the old kind allowed.
 */
export function changeStep(
  steps: readonly DraftStep[],
  stepId: string,
  change: StepChange,
  roleOf: (personId: string) => string | null,
): DraftStep[] {
  return steps.map((step) => {
    if (step.id !== stepId) {
      return step;
    }
    const next = { ...step, ...change };
    const kindChanged = change.kind !== undefined && change.kind !== step.kind;
    const role = next.assignee_id === null ? null : roleOf(next.assignee_id);
    return {
      ...next,
      title_i18n: change.title !== undefined ? {} : next.title_i18n,
      assignee_id:
        kindChanged && role !== null && !PLAN_STEP_ROLES[next.kind].includes(role)
          ? null
          : next.assignee_id,
      linked_problem_id: kindChanged && next.kind !== 'repair' ? null : next.linked_problem_id,
    };
  });
}

export interface ThemeGroupOf<T> {
  theme: string;
  steps: readonly T[];
}

/** Steps gathered by theme, in the order the themes first appear. */
export function groupByTheme<T extends { theme: string }>(steps: readonly T[]): ThemeGroupOf<T>[] {
  const themes = [...new Set(steps.map((step) => step.theme))];
  return themes.map((theme) => ({ theme, steps: steps.filter((step) => step.theme === theme) }));
}

export interface PlanSummary {
  tasks: number;
  inspections: number;
  requests: number;
  decisions: number;
  linked: number;
}

/** What a launch will make: said before the button, not after it. */
export function planSummary(steps: readonly DraftStep[]): PlanSummary {
  const count = (test: (step: DraftStep) => boolean) => steps.filter(test).length;
  return {
    tasks: count((step) => step.kind === 'repair' && step.linked_problem_id === null),
    inspections: count((step) => step.kind === 'inspection'),
    requests: count((step) => step.kind === 'purchase'),
    decisions: count((step) => step.kind === 'decision'),
    linked: count((step) => step.linked_problem_id !== null),
  };
}

/** Each refused step and why, from the `detail` of serverErrors.planNotLaunchable. */
export function refusalsOf(error: unknown): ReadonlyMap<string, string> {
  const details = (error as { details?: unknown } | null)?.details;
  if (typeof details !== 'string') {
    return new Map();
  }
  try {
    const parsed = JSON.parse(details) as { steps?: { step: string; reason: string }[] };
    return new Map((parsed.steps ?? []).map(({ step, reason }) => [step, reason]));
  } catch {
    return new Map();
  }
}

/** Themes a live plan of the place already holds: a second plan would repeat its work. */
export function themesInLivePlans(
  plans: readonly PlacePlan[],
): ReadonlyMap<string, string> {
  const live = plans.filter((plan) => plan.status === 'draft' || plan.status === 'launched');
  return new Map(live.flatMap((plan) => plan.themes.map((theme) => [theme, plan.id] as const)));
}

/** A plan's themes merged with a theme or two more, each once. */
export function themesToAdd(
  wanted: readonly string[],
  steps: readonly { theme: string }[],
): string[] {
  const held = new Set(steps.map((step) => step.theme));
  return wanted.filter((theme) => !held.has(theme));
}
