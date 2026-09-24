import { supabase } from '@/lib/supabase';

import { reportPropertyListSchema, type ReportProperty } from './schema';

/**
 * The places this person may report about.
 *
 * Read from the view rather than from `properties`: the table shows her more
 * than she may report about — the places of her past tasks, problems and
 * requests, and the listing above each (window 3, docs/window3-plan.md). The
 * view carries the same predicate the writer refuses by, so the picker cannot
 * offer a place the report would then bounce off.
 */
export async function fetchReportProperties(): Promise<ReportProperty[]> {
  const { data, error } = await supabase
    .from('report_properties')
    .select('id, name, parent_id, hostaway_unit_id, parent_name')
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  return reportPropertyListSchema.parse(data ?? []);
}
