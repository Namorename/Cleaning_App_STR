import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { useRole } from '@/features/auth/use-role';
import { ON_OPEN_FRESH_MS, useHostSettings } from '@/features/host/use-host';
import { readCached } from '@/lib/read-cached';

import { fetchProblemCategories } from './api';
import { problemCategoryListSchema, type ProblemCategory } from './categories';
import { problemCategoryKeys } from './keys';

/**
 * The catalogue restored from disk is in the shape the build that saved it
 * read (`readCached`). Module-level so a query runs it only when its data changes.
 */
function readCategories(data: unknown): ProblemCategory[] {
  return readCached(problemCategoryListSchema, data, 'problem categories');
}

/**
 * What a cleaner picks a task's category from, or null when she types a title.
 *
 * The catalogue is the cleaner's alone, and only where the company reports by
 * catalogue (hosts.problem_report_mode, 20261115100000): a technician, the head
 * technician and a manager type a title as before, and so does everybody of a
 * company that never switched.
 *
 * The switch and the list are read again as the form opens when the copy is
 * older than five minutes (`ON_OPEN_FRESH_MS`), and live on the phone's disk
 * like every read: she picks without a connection. A phone that has never had
 * the list — a first read that failed, or is still on its way — gets null, and
 * so the typed title: a report is never held up by the catalogue. So is an
 * empty catalogue: nothing to pick would be no way to report at all.
 */
export function useReportCatalog(): readonly ProblemCategory[] | null {
  const { userId } = useSession();
  const role = useRole();
  const settings = useHostSettings(ON_OPEN_FRESH_MS);
  const isOn = role === 'cleaner' && settings.data?.problem_report_mode === 'catalog';

  const categories = useQuery({
    queryKey: problemCategoryKeys.all,
    queryFn: fetchProblemCategories,
    select: readCategories,
    enabled: isOn && userId !== null,
    staleTime: ON_OPEN_FRESH_MS,
  });

  if (!isOn) {
    return null;
  }
  const list = categories.data ?? [];
  return list.length > 0 ? list : null;
}
