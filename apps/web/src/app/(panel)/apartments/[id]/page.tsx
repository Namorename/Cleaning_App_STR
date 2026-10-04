import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';

import {
  DEFAULT_APARTMENTS_ADDRESS,
  readApartmentsAddress,
  writeApartmentsAddress,
} from '@/features/apartments/address';

/** Listing ids come from Hostaway and are whole numbers. */
const Params = z.object({ id: z.coerce.number().int().positive() });

interface PropertyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The old address of a listing's card. Since 5.4 (variant B) a card opens
 * beside the registry at `/apartments?listing=<id>`; a bookmark or a link
 * forwarded before that still leads there, with the card's tab if it named
 * one. A malformed id is a 404, not a query.
 */
export default async function PropertyPage({ params, searchParams }: PropertyPageProps) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const { card } = readApartmentsAddress(new URLSearchParams(onlyStrings(await searchParams)));
  redirect(
    `/apartments?${writeApartmentsAddress({ ...DEFAULT_APARTMENTS_ADDRESS, listing: parsed.data.id, card })}`,
  );
}

/** The query as Next hands it over, without the repeated keys a link should not have. */
function onlyStrings(
  search: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(search).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
