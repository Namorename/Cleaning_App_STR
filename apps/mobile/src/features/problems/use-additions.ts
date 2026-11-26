import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { readCached } from '@/lib/read-cached';

import { additionListSchema, fetchAdditions, publishOfficeMedia, type Addition } from './additions';
import { problemKeys } from './keys';

/** The batches as the disk keeps them, read by today's schema. */
function readAdditions(data: unknown): Addition[] {
  return readCached(additionListSchema, data, 'additions');
}

/** What the office added to the task: its batches, files and the closing's comment. */
export function useAdditions(problemId: string) {
  const { userId } = useSession();
  return useQuery({
    queryKey: problemKeys.additions(problemId),
    queryFn: () => fetchAdditions(problemId),
    select: readAdditions,
    enabled: userId !== null && problemId !== '',
  });
}

/** «Добавить»: the batch shows on the task; the task's batches are read again. */
export function usePublishOfficeMedia(problemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: publishOfficeMedia,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: problemKeys.additions(problemId) }),
  });
}
