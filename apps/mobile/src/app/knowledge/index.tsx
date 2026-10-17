import { useTranslation } from 'react-i18next';

import { SignedInRoute } from '@/features/auth/signed-in-route';
import { KnowledgeScreen } from '@/features/knowledge/knowledge-screen';

/**
 * «База знаний», opened from the settings or from a place's instructions. The
 * header and its title are the root layout's (app/_layout.tsx).
 */
export default function KnowledgeRoute() {
  const { t } = useTranslation();

  return (
    <SignedInRoute loadingText={t('common.loading')}>
      <KnowledgeScreen />
    </SignedInRoute>
  );
}
