import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { hasBoards } from '@/features/auth/role';
import { useRole } from '@/features/auth/use-role';
import { BoardsTab } from '@/features/manager-boards/boards-tab';

/** Set by a tap on «Вам передана доска» (features/push/destination.ts): the board to show. */
const Params = z.object({ board: z.string().uuid().optional() });

/**
 * «Доски» — the office's manager boards (20261118200000, docs/manager-boards.md).
 * The tab is in the bar for a manager or an admin only ((tabs)/_layout.tsx);
 * anybody else reaching the route by a link is sent to the first tab. What
 * anybody may read of the boards is the server's to decide.
 */
export default function BoardsScreen() {
  const role = useRole();
  const parsed = Params.safeParse(useLocalSearchParams());
  // Forgotten once the tab has taken it: the same board asked for again is a new ask.
  const forget = useCallback(() => router.setParams({ board: undefined }), []);
  if (!hasBoards(role)) {
    return <Redirect href="/(tabs)" />;
  }
  return (
    <BoardsTab
      requestedBoardId={parsed.success ? parsed.data.board : undefined}
      onRequestSeen={forget}
    />
  );
}
