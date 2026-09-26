import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/** Whether the page has hydrated never changes once it has: nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * The web build is rendered to static HTML, where there is no colour scheme
 * to read: the server renders light, and the first client render must match
 * it or hydration fails. The server snapshot below is what hydration reads;
 * the client snapshot takes over right after it, with the scheme the browser
 * reports.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();

  return hasHydrated ? colorScheme : 'light';
}
