import { notFound } from 'next/navigation';

import { listingIdSchema } from '@/features/apartments/address';
import { QualityPlaceView } from '@/features/quality/quality-place-view';

interface QualityPlacePageProps {
  params: Promise<{ id: string }>;
}

/**
 * A place's card. Digits only, the listing's own reading: anything else is a
 * 404, so a path the proxy lets past its check (`x.png`) opens nothing here
 * (app/__tests__/panel-routes.test.ts).
 */
export default async function QualityPlacePage({ params }: QualityPlacePageProps) {
  const parsed = listingIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    notFound();
  }
  return <QualityPlaceView placeId={parsed.data} />;
}
