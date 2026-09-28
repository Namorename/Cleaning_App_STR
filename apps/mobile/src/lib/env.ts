import { z } from 'zod';

/**
 * Public configuration for the cleaner app.
 *
 * Only EXPO_PUBLIC_* values may live here: everything in the bundle is
 * readable once the binary is unpacked. The publishable key is safe by
 * design — row level security, not secrecy, is what protects the data. The
 * secret key and the Hostaway credentials never leave the server.
 */
const envSchema = z.object({
  supabaseUrl: z.string().url(),
  supabasePublishableKey: z.string().min(1),
  // Where crash reports go (lib/sentry.ts). Optional: a development run and a
  // build without it simply report nothing. A DSN only lets one send reports.
  // One that is not a URL means no reports, never an app that will not start.
  sentryDsn: z.string().url().optional().catch(undefined),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  // An empty value in an EAS environment means "none", not a malformed URL.
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN || undefined,
});

if (!parsed.success) {
  // Failing at import time is deliberate: a missing key produces a wall of
  // confusing 401s at runtime otherwise, and the fix (copy .env.example) is
  // the same in every case.
  throw new Error(
    'Supabase configuration is missing. Copy apps/mobile/.env.example to .env and fill in the values.',
  );
}

export const env: Env = parsed.data;
