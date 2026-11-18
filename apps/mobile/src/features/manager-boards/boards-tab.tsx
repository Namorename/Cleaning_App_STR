import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';

/**
 * The office's tab of manager boards (20261118200000, docs/manager-boards.md).
 * A placeholder while the boards' screens are built on their own branch.
 */
export function BoardsTab() {
  const { t } = useTranslation();
  return <EmptyState title={t('boards.switcherLabel')} message={t('boards.noBoards')} />;
}
