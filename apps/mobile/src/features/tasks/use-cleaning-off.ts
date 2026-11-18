import { useMutation, useQueryClient } from '@tanstack/react-query';

import { cancelCleaning, declineCleaning, interruptCleaning } from './api';
import type { CleaningOffKind } from './offs';
import { refreshTaskLists } from './use-tasks';

export interface CleaningOffVariables {
  kind: CleaningOffKind;
  taskId: string;
  /** The person's words, trimmed (`reasonToSend`); null when they wrote none. */
  reason: string | null;
}

/**
 * Its own key, under none of the queue's: no default is registered for it
 * (`registerTaskMutations`), so nothing could replay it after a restart.
 */
const CLEANING_OFF_KEY = ['cleaning-off'] as const;

/**
 * A cleaning taken off is dispatch, as the head technician's hand-out is
 * (features/board/use-board.ts), not a move of the queue: sent at once or not
 * at all, one try, never paused on disk and never replayed — a decline sent
 * hours later, after a restart, would hand back a cleaning the office has
 * given her again since, or one she has started meanwhile. 'always' is what
 * keeps it off the disk (lib/move-queue.ts, `waitsForSignal`;
 * lib/query-client.ts, `shouldSaveMove`). Without signal it fails at once,
 * and the sheet says so.
 */
const DISPATCH = { mutationKey: CLEANING_OFF_KEY, networkMode: 'always', retry: false } as const;

function takeCleaningOff({ kind, taskId, reason }: CleaningOffVariables): Promise<void> {
  switch (kind) {
    case 'decline':
      return declineCleaning(taskId, reason);
    case 'interrupt':
      // The sheet sends none without a reason; were one to come, the server says it is missing.
      return interruptCleaning(taskId, reason ?? '');
    case 'cancel':
      return cancelCleaning(taskId, reason);
  }
}

/**
 * «Отказаться», «Прервать уборку» or «Отменить уборку».
 *
 * Settled either way, the cleanings are read again — a refusal too:
 * «Это уже изменилось — экран обновлён» must be true. A cancel keeps its
 * sheet busy until that read lands, so the sheet closes over the screen that
 * shows the closed cleaning (its «Выполненные» read again too: a finished
 * cleaning cancelled leaves them). A hand-back does not wait: the cleaning is
 * no longer hers, and her screen leaves it at once.
 */
export function useCleaningOff() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, CleaningOffVariables>({
    mutationFn: takeCleaningOff,
    ...DISPATCH,
    onSettled: (_data, _error, { kind }) => {
      const isCancel = kind === 'cancel';
      const refresh = refreshTaskLists(queryClient, { withDone: isCancel });
      return isCancel ? refresh : undefined;
    },
  });
}
