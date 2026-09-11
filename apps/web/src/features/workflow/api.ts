import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  processPayload,
  workflowStepListSchema,
  workflowTemplateSchema,
  type ProcessDraft,
  type ProcessSource,
  type WorkflowScope,
  type WorkflowStep,
  type WorkflowTemplate,
} from './schema';

export type Client = SupabaseClient<Database>;

const TEMPLATE_COLUMNS = 'id, scope, property_id, name, is_active, version';
const STEP_COLUMNS =
  'id, type, required, title, instructions, min_photos, max_photos, max_video_sec';

/**
 * The template this scope and listing own, active or not.
 *
 * Deliberately not `resolve_workflow_template`, which treats a switched-off
 * template as absent. That is right for a cleaning and wrong for an editor:
 * a manager who paused an override has to be able to find it again and turn
 * it back on.
 */
async function fetchOwnTemplate(
  client: Client,
  scope: WorkflowScope,
  propertyId: number | null,
): Promise<WorkflowTemplate | null> {
  const query = client.from('workflow_templates').select(TEMPLATE_COLUMNS).eq('scope', scope);
  const { data, error } = await (propertyId === null
    ? query.is('property_id', null)
    : query.eq('property_id', propertyId)
  ).maybeSingle();

  if (error) {
    throw error;
  }
  return data === null ? null : workflowTemplateSchema.parse(data);
}

async function fetchTemplateById(client: Client, id: string): Promise<WorkflowTemplate | null> {
  const { data, error } = await client
    .from('workflow_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : workflowTemplateSchema.parse(data);
}

async function fetchSteps(client: Client, templateId: string): Promise<WorkflowStep[]> {
  const { data, error } = await client
    .from('workflow_steps')
    .select(STEP_COLUMNS)
    .eq('template_id', templateId)
    .order('sort_order', { ascending: true });
  if (error) {
    throw error;
  }
  return workflowStepListSchema.parse(data ?? []);
}

/**
 * The process that applies here, and its steps.
 *
 * A listing is asked about in two stages, because the two answers mean
 * different things. Its own template — even a paused one — is what the editor
 * edits. Failing that, `resolve_workflow_template` says which template a
 * cleaning of this flat would actually follow: the parent's, or the company
 * default. Those steps are shown so the manager can see what she is about to
 * diverge from, and `processDraftFrom` strips their ids so editing them
 * writes a template of this listing's own.
 */
export async function fetchProcess(
  client: Client,
  scope: WorkflowScope,
  propertyId: number | null,
): Promise<ProcessSource> {
  const own = await fetchOwnTemplate(client, scope, propertyId);
  if (own !== null) {
    return { template: own, steps: await fetchSteps(client, own.id) };
  }
  if (propertyId === null) {
    return { template: null, steps: [] };
  }

  const { data: resolved, error } = await client.rpc('resolve_workflow_template', {
    p_property_id: propertyId,
    p_scope: scope,
  });
  if (error) {
    throw error;
  }
  if (resolved === null) {
    return { template: null, steps: [] };
  }

  const inherited = await fetchTemplateById(client, resolved);
  if (inherited === null) {
    return { template: null, steps: [] };
  }
  return { template: inherited, steps: await fetchSteps(client, inherited.id) };
}

/**
 * Write the whole process in one call.
 *
 * The RPC keeps the steps the payload names, updates the ones that arrive
 * with an id it recognises and deletes the rest, so removing a step in the
 * editor means sending the list without it. A task already under way keeps
 * the snapshot it started with; this only changes the cleanings still to come.
 */
export async function saveProcess(client: Client, draft: ProcessDraft): Promise<void> {
  const { error } = await client.rpc('save_workflow_template', {
    p_template: processPayload(draft) as never,
  });
  if (error) {
    throw error;
  }
}
