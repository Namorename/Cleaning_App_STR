import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Side-effect import: initialises i18next before any screen renders.
import '@/i18n';

import { navigationFonts } from '@/components/text';
import { Colors, type ThemeName } from '@/constants/theme';
import { SessionProvider } from '@/features/auth/session';
import { ProfileLanguageGate } from '@/features/profile/language-gate';
import { PushBridge } from '@/features/push/push-bridge';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { holdSplash, useAppReady } from '@/lib/app-ready';
import { subscribeFocusToAppState } from '@/lib/app-focus';
import { markAppDrawn } from '@/components/route-error';
import { FontsReadyProvider } from '@/lib/fonts-ready';
import { watchNetwork } from '@/lib/network';
import { createAppQueryClient, persistOptions } from '@/lib/query-client';
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

  // From the first commit of the screens on, the root boundary catches
  // instead of crashing. Not before: while the splash is up nothing is drawn
  // yet, and a first screen that cannot draw must still crash, so that
  // expo-updates rolls a broken update back.
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
        void queryClient
          .resumePausedMutations()
          .then(() => queryClient.invalidateQueries({ queryKey: ['tasks'] }));
      }}
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
                  <Stack.Screen
                    name="settings"
                    options={{
                      headerShown: true,
                      headerBackTitle: t('common.back'),
                      title: t('settings.title'),
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
