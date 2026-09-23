import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

/** The statuses after which a task is history and no cancel may touch it. */
const CLOSED_STATUSES = '(done,cancelled,expired)';

/**
 * Cancel a task, but only while it is still live.
 *
 * A manager's screen can be minutes old: cancelling by id alone once turned a
 * repair the technician had just finished into `cancelled`, reopened its
 * problem and took the report and its chat from the technician (migration
 * 20260923130000). The status filter makes a stale click land on nothing, and
 * nothing is reported with the same shape a server refusal has, so the screen
 * shows a translated sentence and refreshes.
 *
 * A manager writes tasks under row level security; there is no RPC for this
 * on purpose.
 */
export async function cancelLiveTask(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<void> {
  const { data, error } = await client
    .from('tasks')
    .update({ status: 'cancelled' })
    .eq('id', taskId)
    .not('status', 'in', CLOSED_STATUSES)
    .select('id');
  if (error) {
    throw error;
  }
  if (data.length === 0) {
    throw Object.assign(new Error(`Task ${taskId} is no longer live`), {
      hint: 'serverErrors.taskChangedMeanwhile',
    });
  }
}
