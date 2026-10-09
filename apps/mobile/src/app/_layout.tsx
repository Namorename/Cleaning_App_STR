import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Side-effect import: initialises i18next before any screen renders.
import '@/i18n';

import { navigationFonts } from '@/components/text';
import { Colors, type ThemeName } from '@/constants/theme';
import { createRestoreGate, forgetListsOnSignOut } from '@/features/auth/forget-on-sign-out';
import { SessionProvider } from '@/features/auth/session';
import { ProfileLanguageGate } from '@/features/profile/language-gate';
import { PushBridge } from '@/features/push/push-bridge';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { holdSplash, useAppReady } from '@/lib/app-ready';
import { subscribeFocusToAppState } from '@/lib/app-focus';
import { markAppDrawn } from '@/components/route-error';
import { FontsReadyProvider } from '@/lib/fonts-ready';
import { watchNetwork } from '@/lib/network';
import { createAppQueryClient, persistOptions, resumeSavedMoves } from '@/lib/query-client';
import { useSystemBackground } from '@/lib/theme-preference';

// The last net under every screen: once the app has drawn, a render error
// shows a retry instead of closing the app. Screens that can fail on their own
// data carry their own boundary.
export { RootRouteError as ErrorBoundary } from '@/components/route-error';

// The splash stays until the font is in (or has failed, or taken too long):
// the first screen is drawn once, in the font it keeps.
holdSplash();

/**
 * Navigation chrome painted from the app's own palette, in the app's font.
 *
 * The stock navigation themes carry their own greys, so headers and the tab
 * bar drifted a shade away from the screens underneath them and, in dark mode,
 * from the text drawn on top of them.
 */
function navigationTheme(scheme: ThemeName, areFontsLoaded: boolean) {
  const stock = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const palette = Colors[scheme];
  return {
    ...stock,
    colors: {
      ...stock.colors,
      background: palette.background,
      card: palette.card,
      text: palette.text,
      border: palette.divider,
      primary: palette.primary,
    },
    fonts: navigationFonts(areFontsLoaded, stock.fonts),
  };
}

export default function RootLayout() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const scheme: ThemeName = colorScheme === 'dark' ? 'dark' : 'light';
  const { isReady, areFontsLoaded } = useAppReady();
  const theme = useMemo(() => navigationTheme(scheme, areFontsLoaded), [scheme, areFontsLoaded]);
  // The root view behind the screens takes the theme's background, on start
  // and whenever the theme changes — the system's or the one she chose.
  useSystemBackground(scheme);

  // Created once per app run, not per render: a new QueryClient would throw
  // away every cached list on the next re-render.
  const [queryClient] = useState(createAppQueryClient);

  // A poll stops when the phone is locked and a stale list refreshes when
  // the app comes back; without this the client thinks it is always in front.
  useEffect(() => subscribeFocusToAppState(), []);

  // Losing the network pauses the moves at once instead of after a failure;
  // the server, not the radio, decides when they go out again.
  useEffect(() => watchNetwork(), []);

  // Opened once the cache is back from disk: nothing is forgotten before, or
  // the restore would bring it back.
  const [restore] = useState(createRestoreGate);

  // Whoever signs out takes their lists with them, and a session that is
  // somebody else's forgets the lists of the one before: the next person on a
  // shared phone sees none of them before their own first read.
  useEffect(() => forgetListsOnSignOut(queryClient, restore.done), [queryClient, restore]);

  // Until this runs the root boundary rethrows; from then on it catches. It
  // runs after the first commit of the root with the app ready: the root
  // layout and the spinner app/index.tsx draws while the session is read. A
  // render error in that commit still crashes, so expo-updates rolls a broken
  // update back. A render error in any later commit — the tabs and the first
  // list once the session is in, any screen opened after — does not crash and
  // is not rolled back: the root shows "screen failed" with a retry. That is
  // deliberate: those screens draw the lists restored from disk, a crash would
  // only start again on the same lists, and the root's "reset saved lists"
  // (`common.resetSaved`) is the way out of that loop.
  useEffect(() => {
    if (isReady) {
      markAppDrawn();
    }
  }, [isReady]);

  if (!isReady) {
    return null;
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
      // Moves tapped without signal were paused on disk; once the cache is
      // back they go through, and the lists that show them are refreshed.
      onSuccess={() => {
        restore.open();
        void resumeSavedMoves(queryClient);
      }}
      // Unreadable, the cache was thrown away: there is nothing to come back.
      onError={restore.open}
    >
      <SessionProvider>
        {/*
          Inside the session, because the language belongs to the person who
          signed in; above everything that draws text, because switching it
          redraws the lot.
        */}
        <ProfileLanguageGate>
          {/* Inside the language: the Android channels are named in hers. */}
          <PushBridge />
          <SafeAreaProvider>
            <FontsReadyProvider value={areFontsLoaded}>
              <ThemeProvider value={theme}>
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen
                    name="task/[id]/index"
                    options={{ headerShown: true, headerBackTitle: t('common.back') }}
                  />
                  <Stack.Screen
                    name="task/[id]/step/[stepId]"
                    options={{ headerShown: true, headerBackTitle: t('common.back') }}
                  />
                  {/*
                    A video step's camera, the whole screen under its header.
                    Titled here: the screen draws a permission question or a
                    failure before it ever draws the camera.
                  */}
                  <Stack.Screen
                    name="task/[id]/step/[stepId]/record"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('video.recordTitle'),
                    }}
                  />
                  <Stack.Screen
                    name="settings"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('settings.title'),
                    }}
                  />
                  {/*
                    A report's three screens. Titled here rather than by the
                    screen, for the reason the chat below gives: a report still
                    loading, or one that failed, is drawn under the same header.
                  */}
                  <Stack.Screen
                    name="problem/new"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('problems.new'),
                    }}
                  />
                  <Stack.Screen
                    name="problem/[id]/index"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('problems.one'),
                    }}
                  />
                  <Stack.Screen
                    name="problem/[id]/edit"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('problems.editTitle'),
                    }}
                  />
                  {/* The head technician's history of a task (features/history). */}
                  <Stack.Screen
                    name="problem/[id]/history"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('problems.history.title'),
                    }}
                  />
                  {/*
                    A supply request's two screens, titled here for the same
                    reason. The form's screen also rewrites a request that is
                    still new, and then retitles itself.
                  */}
                  <Stack.Screen
                    name="supply/new"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('supplies.new'),
                    }}
                  />
                  <Stack.Screen
                    name="supply/[id]"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('supplies.one'),
                    }}
                  />
                  {/* Static text from the settings: no data, so no sign-in guard. */}
                  <Stack.Screen
                    name="font-license"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('settings.fontLicense.title'),
                    }}
                  />
                  {/*
                    The title is set here, not by the screen: a thread that fails
                    on its first render never draws its own, and the header would
                    show the route's file name above the error.
                  */}
                  <Stack.Screen
                    name="chat/[subject]/[id]"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('chat.title'),
                    }}
                  />
                  {/* Over the tabs, before the system asks: why notifications. */}
                  <Stack.Screen
                    name="notifications"
                    options={{
                      presentation: 'modal',
                      headerShown: true,
                      title: t('notifications.intro.title'),
                    }}
                  />
                </Stack>
              </ThemeProvider>
            </FontsReadyProvider>
          </SafeAreaProvider>
        </ProfileLanguageGate>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}
