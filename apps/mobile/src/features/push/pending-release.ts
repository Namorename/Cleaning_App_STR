import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

import { clearThisPhone, releasePushToken } from './api';
import { isSigningOut, rememberedToken } from './token-store';

/**
 * A phone let go of after a sign-out nobody heard (owner's word of
 * 2026-10-11, 00:40; docs/f11-native-review.md, Т-3).
 *
 * Without signal the sign-out removes her session all the same, and the
 * server goes on sending her pushes to this phone; a session that ends without
 * the button — a refused refresh, a new password — never lets go at all. Such
 * a token is kept here as "to be let go of", with the moment, and sent
 * through release_push_token when the phone can: at the start, on coming back
 * to the app, on coming back online (hooks.ts) — with no session needed. The
 * server lets go only if nobody bound the token again after that moment, and
 * a registration of the same token here settles it (registration.ts).
 *
 * In the Keychain, as the token itself is (token-store.ts).
 */
const PENDING_KEY = 'push-token-release';

const pendingSchema = z.object({ token: z.string().min(1), since: z.string().min(1) });

export type PendingRelease = z.infer<typeof pendingSchema>;

export async function keepReleasePending(token: string, since: Date = new Date()): Promise<void> {
  await SecureStore.setItemAsync(
    PENDING_KEY,
    JSON.stringify({ token, since: since.toISOString() }),
  );
}

/** The phone's own token kept to be let go of, when it has one: before the phone forgets it. */
export async function keepThisPhonePending(since: Date = new Date()): Promise<void> {
  const token = await rememberedToken();
  if (token !== null) {
    await keepReleasePending(token, since);
  }
}

/** What waits to be let go of; something unreadable is no release, and goes. */
export async function pendingRelease(): Promise<PendingRelease | null> {
  const raw = await SecureStore.getItemAsync(PENDING_KEY);
  if (raw === null) {
    return null;
  }
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    // Unreadable: read as nothing below.
  }
  const parsed = pendingSchema.safeParse(data);
  if (!parsed.success) {
    await SecureStore.deleteItemAsync(PENDING_KEY);
    return null;
  }
  return parsed.data;
}

/** A registration of `token` landed: its binding moved, nothing of it waits any more. */
export async function settlePendingRelease(token: string): Promise<void> {
  const pending = await pendingRelease();
  if (pending?.token === token) {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  }
}

/** The release on its way, if any: asked twice at once, it goes once. */
let sending: Promise<void> | null = null;

/** Sends what waits to be let go of. Never throws: what is not heard waits for the next chance. */
export function flushPendingRelease(): Promise<void> {
  if (Platform.OS === 'web') {
    return Promise.resolve();
  }
  sending ??= sendOnce()
    .catch(() => undefined)
    .finally(() => {
      sending = null;
    });
  return sending;
}

async function sendOnce(): Promise<void> {
  const pending = await pendingRelease();
  if (pending === null) {
    return;
  }
  if (!(await releasePushToken(pending.token, pending.since))) {
    return;
  }
  // Only this release is settled: one kept meanwhile for a later sign-out stays.
  const now = await pendingRelease();
  if (now?.token === pending.token && now.since === pending.since) {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  }
}

/**
 * The session ended without the button (forget-on-sign-out.ts): the phone's
 * token waits to be let go of, the phone forgets it and what it shows of her,
 * and the release is sent. The button's own sign-out lets go itself
 * (session.tsx) and is left alone. Never throws.
 */
export async function letGoAfterSessionEnded(): Promise<void> {
  if (Platform.OS === 'web' || isSigningOut()) {
    return;
  }
  try {
    const token = await rememberedToken();
    if (token === null) {
      return;
    }
    await keepReleasePending(token);
    await clearThisPhone();
  } catch {
    // The Keychain refused: nothing to keep, and nothing more to do here.
    return;
  }
  await flushPendingRelease();
}
