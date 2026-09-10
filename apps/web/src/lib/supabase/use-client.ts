'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';
import { useState } from 'react';

import { createClient } from './client';

export type Client = SupabaseClient<Database>;

/** One browser client per component tree; the cookie session is shared anyway. */
export function useSupabase(): Client {
  const [client] = useState(() => createClient());
  return client;
}
