import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';

import { NUNITO_FONTS } from './fonts';
import { reportError } from './sentry';

/**
 * How long the splash waits for the font before the app goes on without it.
 * The files are on the phone already (an update is downloaded whole before it
 * runs), so loading them takes a moment; this is the ceiling for a phone that
 * is struggling, not a wait anyone is meant to see.
 */
export const FONT_WAIT_MS = 3_000;

/**
 * Keep the splash up past the first render, called once when the root layout
 * loads. From then on the app — not expo-router — decides when it goes, and
 * `useAppReady` lets it go. A splash that cannot be held only means the first
 * frame may show the system font; it is reported, never thrown.
 */
export function holdSplash(): void {
  SplashScreen.preventAutoHideAsync().catch(reportError);
}

export interface AppReadiness {
  /** The first screen may be drawn: the splash has been let go. */
  isReady: boolean;
  /** Nunito is in; until then — or for good, if it failed — the system font. */
  areFontsLoaded: boolean;
}

/**
 * Ready once the font is in, has failed, or has taken longer than
 * `FONT_WAIT_MS` — never later: she is never left looking at the splash. A
 * font that loads after the wait still arrives, and the text redraws in it.
 */
export function useAppReady(): AppReadiness {
  const [areFontsLoaded, fontError] = useFonts(NUNITO_FONTS);
  const [hasWaited, setHasWaited] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHasWaited(true), FONT_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontError !== null) {
      reportError(fontError);
    }
  }, [fontError]);

  const isReady = areFontsLoaded || fontError !== null || hasWaited;

  useEffect(() => {
    if (isReady) {
      SplashScreen.hide();
    }
  }, [isReady]);

  return { isReady, areFontsLoaded };
}
