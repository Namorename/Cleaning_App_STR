import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Side-effect import: initialises i18next before any screen renders.
import '@/i18n';

import { Colors } from '@/constants/theme';
import { SessionProvider } from '@/features/auth/session';
import { ProfileLanguageGate } from '@/features/profile/language-gate';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribeFocusToAppState } from '@/lib/app-focus';
import { markAppDrawn } from '@/components/route-error';
import { createAppQueryClient, persistOptions } from '@/lib/query-client';

// The last net under every screen: once the app has drawn, a render error
// shows a retry instead of closing the app. Screens that can fail on their own
// data carry their own boundary.
export { RootRouteError as ErrorBoundary } from '@/components/route-error';

/**
 * Navigation chrome painted from the app's own palette.
 *
 * The stock navigation themes carry their own greys, so headers and the tab
 * bar drifted a shade away from the screens underneath them and, in dark mode,
 * from the text drawn on top of them.
 */
const navigationThemes = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: Colors.light.background,
      card: Colors.light.card,
      text: Colors.light.text,
      border: Colors.light.divider,
      primary: Colors.light.primary,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: Colors.dark.background,
      card: Colors.dark.card,
      text: Colors.dark.text,
      border: Colors.dark.divider,
      primary: Colors.dark.primary,
    },
  },
} as const;

export default function RootLayout() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();

  // Created once per app run, not per render: a new QueryClient would throw
  // away every cached list on the next re-render.
  const [queryClient] = useState(createAppQueryClient);

  // A poll stops when the phone is locked and a stale list refreshes when
  // the app comes back; without this the client thinks it is always in front.
  useEffect(() => subscribeFocusToAppState(), []);

  // From the first commit on, the root boundary catches instead of crashing.
  useEffect(() => markAppDrawn(), []);

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
          <SafeAreaProvider>
            <ThemeProvider
              value={colorScheme === 'dark' ? navigationThemes.dark : navigationThemes.light}
            >
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
              </Stack>
            </ThemeProvider>
          </SafeAreaProvider>
        </ProfileLanguageGate>
      </SessionProvider>
    </PersistQueryClientProvider>
  );
}
