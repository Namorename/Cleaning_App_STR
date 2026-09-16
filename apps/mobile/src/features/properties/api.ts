import { supabase } from '@/lib/supabase';

import { reportPropertyListSchema, type ReportProperty } from './schema';

/**
 * The places this person may report about.
 *
 * Read from the view rather than from `properties`: the read policy on the
 * table hands every active member of staff the whole company, because a
 * cleaner has to be able to read the listing of a task she is holding. The
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
