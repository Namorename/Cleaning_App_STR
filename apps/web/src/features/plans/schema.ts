import {
  PLAN_STEP_KINDS,
  PROBLEM_LEVELS,
  problemLevel,
  type ProblemLevel,
  type Tone,
} from '@str-ops/shared';
import { z } from 'zod';

/** The manager's choice for a step: the scale of four, «Критическая» last (20261115140000). */
export const PLAN_PRIORITIES = PROBLEM_LEVELS;
export type PlanPriority = ProblemLevel;

const planStepSchema = z.object({
  id: z.uuid(),
  theme: z.string(),
  kind: z.enum(PLAN_STEP_KINDS),
  title: z.string(),
  title_i18n: z.record(z.string(), z.string()).catch({}),
  description: z.string().nullable(),
  assignee_id: z.uuid().nullable(),
  assignee_name: z.string().nullable(),
  due_on: z.string().nullable(),
  priority: z.enum(['low', 'normal', 'high']).catch('normal'),
  // The level above high, beside a priority that reads high (20261115140000); absent before it.
  critical: z.boolean().catch(false).optional(),
  linked_problem_id: z.uuid().nullable(),
  launched_at: z.string().nullable(),
  state: z.enum(['draft', 'open', 'closed']),
  work_status: z.string().nullable(),
  closed_at: z.string().nullable(),
}).transform(({ critical, ...step }) => ({
  ...step,
  priority: problemLevel({ priority: step.priority, critical }),
}));
export type PlanStep = z.infer<typeof planStepSchema>;

export const PLAN_STATUSES = ['draft', 'launched', 'done', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PLAN_STATUS_TONE = {
  draft: 'neutral',
  launched: 'inProgress',
  done: 'done',
  cancelled: 'cancelled',
} as const satisfies Record<PlanStatus, Tone>;

export const planSchema = z.object({
  id: z.uuid(),
  property_id: z.number(),
  property_name: z.string().nullable(),
  title: z.string(),
  status: z.enum(PLAN_STATUSES),
  rev: z.number(),
  created_at: z.string(),
  launched_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  steps: z.array(planStepSchema),
});
export type Plan = z.infer<typeof planSchema>;

const placePlanSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(PLAN_STATUSES),
  rev: z.number(),
  created_at: z.string(),
  launched_at: z.string().nullable(),
  steps_total: z.number(),
  steps_closed: z.number(),
  themes: z.array(z.string()),
});
export type PlacePlan = z.infer<typeof placePlanSchema>;
export const placePlanListSchema = z.array(placePlanSchema);

const placeWorkSchema = z.object({
  problem_id: z.uuid(),
  title: z.string(),
  status: z.string(),
  theme: z.string(),
});
export type PlaceWork = z.infer<typeof placeWorkSchema>;
export const placeWorkListSchema = z.array(placeWorkSchema);
