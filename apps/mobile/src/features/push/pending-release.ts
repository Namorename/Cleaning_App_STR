import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

import { clearThisPhone, releasePushToken } from './api';
import {
  forgetRegistration,
  isSigningOut,
  registrant,
  rememberedOwner,
  rememberedToken,
} from './token-store';

/**
 * A phone let go of after a sign-out nobody heard (owner's words of
 * 2026-10-11, 00:40 and 2026-10-12, 18:20; docs/f11-native-review.md, Т-3).
 *
 * Without signal the sign-out removes her session all the same, and the
 * server goes on sending her pushes to this phone; a session that ends without
 * the button — a refused refresh, a new password — never lets go at all. Such
 * a token is kept here as "to be let go of", with whose it is — the one
 * signing out — and sent through release_push_token when the phone can: at
 * the start, on coming back to the app, on coming back online (hooks.ts) —
 * with no session needed. The server lets go only while the token is still
 * bound to her; no clock takes part. A registration of the same token here
 * settles it (registration.ts), and so does her signing in on the phone again.
 *
 * In the Keychain, as the token itself is (token-store.ts).
 */
const PENDING_KEY = 'push-token-release';

const pendingSchema = z.object({ token: z.string().min(1), profileId: z.string().uuid() });

export type PendingRelease = z.infer<typeof pendingSchema>;

export async function keepReleasePending(token: string, profileId: string): Promise<void> {
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ token, profileId }));
}

/**
 * The phone's own token kept to be let go of, when it has one: before the
 * phone forgets it. Named for whom it was registered — the one signing out —
 * or, for a token kept by a build that did not say, whom this run registered
 * it for. A token nobody can be named for is not kept: the server could not
 * tell it was hers.
 */
export async function keepThisPhonePending(): Promise<void> {
  const token = await rememberedToken();
  if (token === null) {
    return;
  }
  const owner = (await rememberedOwner()) ?? registrant();
  if (owner !== null) {
    await keepReleasePending(token, owner);
  }
}

/** What waits to be let go of; something unreadable — or the earlier draft's, by a moment — is no release, and goes. */
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

/** The sends on their way, if any: asked twice at once, it goes once. */
let sending: Promise<void> | null = null;
/** Asked again while a send was on its way: one more goes right after it. */
let isAskedAgain = false;
/** Who is signed in on the phone, as the latest ask said. */
let signedInNow: string | null = null;

/**
 * Sends what waits to be let go of. `signedIn` is who is signed in on the
 * phone now: her own release is dropped, not sent — she is back, and her
 * binding is wanted. Asked while a send is on its way, it sends again right
 * after that one, with what waits then (owner's word of 2026-10-12). Never
 * throws: what is not heard waits for the next chance.
 */
export function flushPendingRelease(signedIn: string | null = null): Promise<void> {
  if (Platform.OS === 'web') {
    return Promise.resolve();
  }
  signedInNow = signedIn;
  if (sending !== null) {
    isAskedAgain = true;
    return sending;
  }
  sending = sendWhileAsked();
  return sending;
}

/** The release on its way, if any: a registration waits for it (registration.ts). */
export function releaseOnItsWay(): Promise<void> | null {
  return sending;
}

async function sendWhileAsked(): Promise<void> {
  try {
    do {
      isAskedAgain = false;
      await sendOnce(signedInNow).catch(() => undefined);
    } while (isAskedAgain);
  } finally {
    // In the same turn as the last look at the flag: an ask cannot fall
    // between the two and be lost (review of b674010).
    sending = null;
  }
}

async function sendOnce(signedIn: string | null): Promise<void> {
  const pending = await pendingRelease();
  if (pending === null) {
    return;
  }
  if (pending.profileId === signedIn) {
    await forget(pending);
    return;
  }
  if (await releasePushToken(pending.token, pending.profileId)) {
    await forget(pending);
  }
}

/** Only this release is settled: one kept meanwhile for a later sign-out stays. */
async function forget(release: PendingRelease): Promise<void> {
  const now = await pendingRelease();
  if (now?.token === release.token && now.profileId === release.profileId) {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  }
}

/**
 * The session ended without the button (forget-on-sign-out.ts): the phone's
 * token waits to be let go of, in the name it was registered for, the phone
 * forgets it and what it shows of her, and the release is sent. The button's
 * own sign-out lets go itself (session.tsx) and is left alone. Never throws.
 */
export async function letGoAfterSessionEnded(): Promise<void> {
  if (Platform.OS === 'web' || isSigningOut()) {
    return;
  }
  try {
    if ((await rememberedToken()) === null) {
      // No token yet — a registration may still be waiting for one. It must
      // not land now: the next person to sign in would get the token bound
      // to them, with her name kept beside it (review of b674010).
      await forgetRegistration();
      return;
    }
    await keepThisPhonePending();
    await clearThisPhone();
  } catch {
    // The Keychain refused: nothing to keep, and nothing more to do here.
    return;
  }
  await flushPendingRelease();
}
