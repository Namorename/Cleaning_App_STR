import type { Language } from '@str-ops/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

import { forgetRegistration, registrationOnItsWay, rememberedToken } from './token-store';

/**
 * The two calls about the phone's token. Neither goes through the offline
 * queue: a registration is simply made again on the next start, and a let-go
 * replayed after someone else signed in on the phone would run as her.
 *
 * session.tsx calls releaseThisPhone and clearThisPhone, and the web build
 * signs out through them too: nothing native is asked for there.
 */

/** Long enough for a slow network, short enough that signing out never hangs on it. */
export const FORGET_TIMEOUT_MS = 3_000;

export interface PhoneRegistration {
  token: string;
  platform: 'ios' | 'android';
  /** The phone's own language; the one chosen on her profile wins on the server. */
  language: Language;
  appVersion: string | null;
}

/** Idempotent: a token another person registered on this phone moves to her. */
export async function registerPushToken(registration: PhoneRegistration): Promise<void> {
  const { error } = await supabase.rpc('register_push_token', {
    p_token: registration.token,
    p_platform: registration.platform,
    p_language: registration.language,
    p_app_version: registration.appVersion ?? undefined,
  });
  if (error) {
    throw error;
  }
}

/** What letting go of the phone came to: the server heard, nothing was registered, or no answer. */
export type Release = 'released' | 'nothing' | 'unconfirmed';

/**
 * Before signing out, while the call still runs as her: stop pushes about her
 * reaching this phone. A registration on its way is waited for first — it
 * would land after the sign-out and give the phone back to her (Т-1) — but no
 * longer than a let-go itself may take.
 *
 * Never throws and never waits long — signing out must work in a stairwell.
 * The phone's own record stays: it is cleared only once she is out
 * (clearThisPhone), so a sign-out that fails leaves the next one something to
 * let go of (docs/f11-native-review.md, Т-2).
 */
export async function releaseThisPhone(): Promise<Release> {
  if (Platform.OS === 'web') {
    return 'nothing';
  }
  await within(registrationOnItsWay(), FORGET_TIMEOUT_MS);
  const token = await rememberedToken().catch(() => null);
  if (token === null) {
    return 'nothing';
  }
  return (await unregister(token)) ? 'released' : 'unconfirmed';
}

/**
 * Once she is out: the phone forgets her token and takes off it what it still
 * shows of her — her delivered pushes name her flats, and a tap on one not
 * yet followed would be followed for whoever signs in next. Never throws.
 */
export async function clearThisPhone(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  await forgetRegistration().catch(() => undefined);
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Nothing kept to clear: the tap is gone either way.
  }
}

/** Waits for `promise`, if any, but not past `ms`; its outcome does not matter here. */
async function within(promise: Promise<unknown> | null, ms: number): Promise<void> {
  if (promise === null) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([
      promise.then(
        () => undefined,
        () => undefined,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves to whether the server heard; a refusal, no signal or no answer in time is `false`. */
async function unregister(token: string): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(false);
    }, FORGET_TIMEOUT_MS);
  });
  const call = Promise.resolve(
    supabase.rpc('unregister_push_token', { p_token: token }).abortSignal(controller.signal),
  ).then(
    ({ error }) => error === null,
    () => false,
  );
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
