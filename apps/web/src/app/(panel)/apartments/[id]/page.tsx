import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PropertyCard } from '@/features/apartments/property-card';

/** Listing ids come from Hostaway and are whole numbers. */
const Params = z.object({ id: z.coerce.number().int().positive() });

interface PropertyPageProps {
  params: Promise<{ id: string }>;
}

/** A malformed id is a 404, not a query. */
export default async function PropertyPage({ params }: PropertyPageProps) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  return <PropertyCard propertyId={parsed.data.id} />;
}
