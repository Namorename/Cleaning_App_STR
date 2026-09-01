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
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  // Failing at import time is deliberate: a missing key produces a wall of
  // confusing 401s at runtime otherwise, and the fix (copy .env.example) is
  // the same in every case.
  throw new Error(
    'Не задана конфигурация Supabase. Скопируйте apps/mobile/.env.example в .env и заполните значения.',
  );
}

export const env: Env = parsed.data;
