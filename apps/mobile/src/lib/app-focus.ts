import { focusManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * Tell the query client when the app is in front.
 *
 * On the web the client watches the document; on a phone nothing does, so
 * out of the box every query believes the app is always focused: a poll
 * keeps running behind a locked screen, and coming back from a call refreshes
 * nothing. With this wired, a poll pauses in the background and stale lists
 * refresh the moment the app is opened again.
 */
export function subscribeFocusToAppState(): () => void {
  if (Platform.OS === 'web') {
    return () => undefined;
  }
  const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });
  return () => subscription.remove();
}
