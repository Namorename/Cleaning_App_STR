import { z } from 'zod';

import type { Client } from './api';

const tabIdsSchema = z.array(z.string());
const tabOrderRowSchema = z.object({ tab_ids: tabIdsSchema });

/** The columns the panel reads of a person's own order (the postgrest-select test runs it). */
export const TAB_ORDER_SELECT = 'tab_ids';

/**
 * The person's own order of the board tabs, or null when she never chose one.
 * RLS answers her row alone (20261126160000), so no filter is needed.
 */
export async function fetchBoardTabOrder(client: Client): Promise<string[] | null> {
  const { data, error } = await client
    .from('board_tab_orders')
    .select(TAB_ORDER_SELECT)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? null : tabOrderRowSchema.parse(data).tab_ids;
}

/** Saves her order; answers it as stored. */
export async function saveBoardTabOrder(
  client: Client,
  tabIds: readonly string[],
): Promise<string[]> {
  const { data, error } = await client.rpc('save_board_tab_order', { p_tab_ids: [...tabIds] });
  if (error) {
    throw error;
  }
  return tabIdsSchema.parse(data);
}
