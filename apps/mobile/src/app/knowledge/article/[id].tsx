import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { SignedInRoute } from '@/features/auth/signed-in-route';
import { ArticleScreen } from '@/features/knowledge/article-screen';

const Params = z.object({ id: z.string().uuid() });

/** One article of the knowledge base, opened from a list of articles. */
export default function ArticleRoute() {
  const { t } = useTranslation();

  return (
    <SignedInRoute loadingText={t('common.loading')}>
      <Article />
    </SignedInRoute>
  );
}

/**
 * safeParse rather than parse: a malformed link must not crash the screen. An
 * id that is no article's reads as one that is gone.
 */
function Article() {
  const parsed = Params.safeParse(useLocalSearchParams());

  return <ArticleScreen articleId={parsed.success ? parsed.data.id : ''} />;
}
