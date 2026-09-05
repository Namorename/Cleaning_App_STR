import type { Database, Json } from '@str-ops/shared';

import { supabase } from '@/lib/supabase';

import { taskStepListSchema, taskStepSchema, type TaskStep } from './schema';

const STEP_COLUMNS =
  'id, task_id, sort_order, type, required, title, instructions, started_at, ' +
  'completed_at, completed_by, payload, skipped_at, skip_reason, waived_at, waive_reason';

/**
 * The steps of one task, in order.
 *
 * Row level security hands back only the steps of her own tasks; a colleague's
 * task reads as no steps at all, which the screen shows as exactly that.
 */
export async function fetchTaskSteps(taskId: string): Promise<TaskStep[]> {
  const { data, error } = await supabase
    .from('task_steps')
    .select(STEP_COLUMNS)
    .eq('task_id', taskId)
    .order('sort_order', { ascending: true });

  if (error) {
    throw error;
  }

  return taskStepListSchema.parse(data ?? []);
}

/**
 * Every write to a step goes through a database function, never an update.
 *
 * The functions are idempotent — completing a completed step returns it as it
 * is — which is what lets an action queued without signal be replayed on the
 * next launch without inventing a failure. They also validate the answer for
 * the step's type and refuse with a message meant to be shown as it is.
 */
type StepFunction =
  | 'open_task_step'
  | 'complete_task_step'
  | 'reopen_task_step'
  | 'skip_task_step';

type StepFunctionArgs<TName extends StepFunction> =
  Database['public']['Functions'][TName]['Args'];

async function callStepFunction<TName extends StepFunction>(
  name: TName,
  args: StepFunctionArgs<TName>,
): Promise<TaskStep> {
  const { data, error } = await supabase.rpc(name, args);

  if (error) {
    throw error;
  }

  return taskStepSchema.parse(data);
}

export interface StepVariables {
  /** Which task's cache to update; the server does not need it. */
  taskId: string;
  stepId: string;
}

export interface CompleteStepVariables extends StepVariables {
  payload: Json;
  /** The phone's clock at the tap, kept next to the server's stamp. */
  deviceCompletedAt: string;
}

export interface SkipStepVariables extends StepVariables {
  reason?: string;
}

export function openStep({ stepId }: StepVariables): Promise<TaskStep> {
  return callStepFunction('open_task_step', { p_step_id: stepId });
}

export function completeStep({
  stepId,
  payload,
  deviceCompletedAt,
}: CompleteStepVariables): Promise<TaskStep> {
  return callStepFunction('complete_task_step', {
    p_step_id: stepId,
    p_payload: payload,
    p_device_completed_at: deviceCompletedAt,
  });
}

export function reopenStep({ stepId }: StepVariables): Promise<TaskStep> {
  return callStepFunction('reopen_task_step', { p_step_id: stepId });
}

export function skipStep({ stepId, reason }: SkipStepVariables): Promise<TaskStep> {
  return callStepFunction('skip_task_step', { p_step_id: stepId, p_reason: reason });
}
