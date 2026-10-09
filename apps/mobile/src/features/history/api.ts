import { supabase } from '@/lib/supabase';

import { problemEventListSchema, type ProblemEvent } from './schema';

const EVENT_COLUMNS = 'id, problem_id, task_id, kind, actor_id, created_at, params';

/**
 * The journal of one task, oldest first — the story in the order it happened,
 * and the order of its index (problem_id, created_at, id). Read by the manager
 * and the head technician alone (RLS, 20261003140000).
 */
export async function fetchProblemEvents(problemId: string): Promise<ProblemEvent[]> {
  const { data, error } = await supabase
    .from('problem_events')
    .select(EVENT_COLUMNS)
    .eq('problem_id', problemId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return problemEventListSchema.parse(data ?? []);
}
