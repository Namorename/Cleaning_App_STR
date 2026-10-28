import { publicEnv } from '@/lib/env';

import { publicSpec } from '../spec';

/**
 * Five minutes in any cache: the file changes only with a deploy, and a new
 * one reaches every reader within five minutes of it.
 */
const CACHE_CONTROL = 'public, max-age=300';

/**
 * The spec as a file, for agents and client generators: the same document the
 * page renders, its server set to this deployment's API. Open to everyone
 * (`proxy.ts`), like the page.
 *
 * Not `force-static`: that would read the environment at build time, and a
 * build without NEXT_PUBLIC_SUPABASE_URL would fail on this route alone.
 */
export function GET(): Response {
  return Response.json(publicSpec(publicEnv.supabaseUrl), {
    headers: { 'Cache-Control': CACHE_CONTROL },
  });
}
