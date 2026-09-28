import type { Language } from '@str-ops/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

import { forgetRegistration, rememberedToken } from './token-store';

/**
 * The two calls about the phone's token. Neither goes through the offline
 * queue: a registration is simply made again on the next start, and a let-go
 * replayed after someone else signed in on the phone would run as her.
 *
 * session.tsx calls forgetThisPhone, and the web build signs out through it
 * too: nothing native is asked for there.
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

/**
 * Before signing out: stop pushes about her reaching this phone, and take
 * what it still shows of her off it — her delivered pushes name her flats,
 * and a tap on one not yet followed would be followed for whoever signs in
 * next.
 *
 * Never throws and never waits long — signing out must work in a stairwell.
 * When it fails the token stays with her on the server until the next person
 * to sign in here takes it over, and the phone forgets it either way.
 */
export async function forgetThisPhone(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }
  const token = await rememberedToken().catch(() => null);
  if (token !== null) {
    await unregister(token);
  }
  await forgetRegistration().catch(() => undefined);
  await clearWhatIsShown();
}

async function clearWhatIsShown(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Nothing kept to clear: the tap is gone either way.
  }
}

async function unregister(token: string): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, FORGET_TIMEOUT_MS);
  });
  const call = Promise.resolve(
    supabase.rpc('unregister_push_token', { p_token: token }).abortSignal(controller.signal),
  ).then(
    () => undefined,
    () => undefined,
  );
  try {
    // The answer does not matter: a refusal or no signal leaves nothing she can do.
    await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
