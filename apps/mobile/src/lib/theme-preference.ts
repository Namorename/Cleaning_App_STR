import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import { z } from 'zod';

import { Colors, type ThemeName } from '@/constants/theme';

import { reportError } from './sentry';

/**
 * Her theme (owner's decision 6, 2026-10-02): as the system, light or dark.
 *
 * The choice belongs to this phone, not to her profile — a cleaner picks the
 * light theme for the street on her own phone, and nothing on the server needs
 * to know. It is kept in AsyncStorage and handed to React Native's Appearance,
 * which every `useColorScheme` reads, so every screen follows it without a
 * line of its own. The splash is drawn by the system before any of this runs
 * and stays with the system's theme (plan §5).
 */

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/** Where the choice is kept; not part of the query cache, so "reset saved lists" keeps it. */
export const THEME_PREFERENCE_KEY = 'str-ops.theme-preference';

const preferenceSchema = z.enum(THEME_PREFERENCES);

let current: ThemePreference = 'system';
const listeners = new Set<() => void>();

function publish(preference: ThemePreference): void {
  current = preference;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readCurrent(): ThemePreference {
  return current;
}

/** What React Native is told: `unspecified` hands the decision back to the system. */
function applyToAppearance(preference: ThemePreference): void {
  // The web build's Appearance has no override; the browser's own setting rules there.
  if (typeof Appearance.setColorScheme !== 'function') {
    return;
  }
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
}

/**
 * Read her choice and apply it, once at start, before the first screen (the
 * splash waits for it). Nothing chosen — or a value this build does not know
 * — is the system, and then Appearance is left as it is. A store that cannot
 * be read is reported and treated the same: the app never waits on it.
 */
export async function restoreThemePreference(): Promise<ThemePreference> {
  try {
    const stored = preferenceSchema.safeParse(await AsyncStorage.getItem(THEME_PREFERENCE_KEY));
    const preference = stored.success ? stored.data : 'system';
    if (preference !== 'system') {
      applyToAppearance(preference);
    }
    publish(preference);
    return preference;
  } catch (error: unknown) {
    reportError(error);
    return 'system';
  }
}

/**
 * Her choice from the settings: applied at once, then remembered. A choice
 * that cannot be saved still holds until the app is closed; the caller hears
 * of the failure and says so.
 */
export async function chooseThemePreference(preference: ThemePreference): Promise<void> {
  applyToAppearance(preference);
  publish(preference);
  await AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference);
}

/** The current choice, redrawn when it changes. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readCurrent, readCurrent);
}

/**
 * Paint the root view behind every screen with the theme's background, at
 * start and on every change of theme — the system's or hers. Without it a
 * screen that slides in shows the native root's single colour at its edge
 * (on Android this is set anew on every start, plan §5).
 */
export function useSystemBackground(scheme: ThemeName): void {
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(Colors[scheme].background).catch(reportError);
  }, [scheme]);
}
