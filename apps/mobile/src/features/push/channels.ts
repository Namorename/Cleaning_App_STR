import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { i18n } from '@/i18n';

/**
 * Android's notification channels, by the ids send-push names
 * (supabase/functions/send-push/run.ts: `channelId`). A push naming a channel
 * the phone does not have is not shown at all.
 */
export const PUSH_CHANNELS = ['urgent', 'general'] as const;
export type PushChannel = (typeof PUSH_CHANNELS)[number];

/** Where a push without a channel lands; the config plugin names it too (app.config.ts). */
export const DEFAULT_PUSH_CHANNEL: PushChannel = 'general';

/** A short buzz for what cannot wait: the same pattern Android uses for calls, shorter. */
const URGENT_VIBRATION_MS = [0, 250, 250, 250];

/**
 * Makes both channels, or renames them into her language.
 *
 * Run on every start, before a token is asked for or the permission is
 * requested: Android 13 does not show its question until a channel exists.
 * A channel's importance and sound are fixed the day it is made — only the
 * name changes on a second call — so they are decided here, once. No `sound`
 * field: leaving it out is the phone's own sound, and 'default' would be read
 * as a file of that name.
 *
 * Both pop up as a banner (owner, 2026-09-30): she can quiet «Остальные» in
 * Android's settings, or switch kinds off in the app's «Настройки». Only the
 * urgent one buzzes.
 */
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync('urgent', {
    name: i18n.t('settings.notifications.channels.urgent'),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: URGENT_VIBRATION_MS,
  });
  await Notifications.setNotificationChannelAsync('general', {
    name: i18n.t('settings.notifications.channels.general'),
    importance: Notifications.AndroidImportance.HIGH,
  });
}
