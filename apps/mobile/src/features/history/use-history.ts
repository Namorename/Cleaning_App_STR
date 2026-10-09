import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { readCached } from '@/lib/read-cached';

import { fetchProblemEvents } from './api';
import { historyKeys } from './keys';
import { problemEventListSchema, type ProblemEvent } from './schema';

/** Restored from disk in whatever shape the build that saved it read (`readCached`). */
function readEvents(data: unknown): ProblemEvent[] {
  return readCached(problemEventListSchema, data, 'history');
}

/** A task's journal, oldest first, for its history screen. */
export function useProblemEvents(problemId: string) {
  const { userId } = useSession();

  return useQuery({
    queryKey: historyKeys.events(userId ?? '', problemId),
    queryFn: () => fetchProblemEvents(problemId),
    select: readEvents,
    enabled: userId !== null && problemId !== '',
  });
}
