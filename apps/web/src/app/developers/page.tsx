import type { Metadata } from 'next';

import { ApiReference } from './api-reference';

/** English, the product's language; the API and its spec speak nothing else. */
export const metadata: Metadata = {
  title: 'woom API v1',
  description: 'The woom public API, version 1: authentication, scopes, endpoints and examples.',
};

/**
 * The public API's documentation, open to everyone: no sign-in (`proxy.ts`
 * lets `/developers` through for anyone) and no Supabase call. The spec is
 * the committed file (docs/api-v1.md §9); a reader tries a request with a key
 * of their own, typed into the page and kept nowhere.
 */
export default function DevelopersPage() {
  return <ApiReference />;
}
