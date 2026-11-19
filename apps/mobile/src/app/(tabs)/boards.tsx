import { Redirect } from 'expo-router';

import { hasBoards } from '@/features/auth/role';
import { useRole } from '@/features/auth/use-role';
import { BoardsTab } from '@/features/manager-boards/boards-tab';

/**
 * «Доски» — the office's manager boards (20261118200000, docs/manager-boards.md).
 * The tab is in the bar for a manager or an admin only ((tabs)/_layout.tsx);
 * anybody else reaching the route by a link is sent to the first tab. What
 * anybody may read of the boards is the server's to decide.
 */
export default function BoardsScreen() {
  if (!hasBoards(useRole())) {
    return <Redirect href="/(tabs)" />;
  }
  return <BoardsTab />;
}
