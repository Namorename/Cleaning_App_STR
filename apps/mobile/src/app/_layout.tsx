import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Side-effect import: initialises i18next before any screen renders.
import '@/i18n';

import { Colors } from '@/constants/theme';
import { SessionProvider } from '@/features/auth/session';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
  const colorScheme = useColorScheme();

  // Created once per app run, not per render: a new QueryClient would throw
  // away every cached list on the next re-render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // A cleaner's phone drops to no signal inside stairwells more
            // often than the server actually fails.
            retry: 2,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <SafeAreaProvider>
          <ThemeProvider
            value={colorScheme === 'dark' ? navigationThemes.dark : navigationThemes.light}
          >
            <Stack screenOptions={{ headerShown: false }} />
          </ThemeProvider>
        </SafeAreaProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
