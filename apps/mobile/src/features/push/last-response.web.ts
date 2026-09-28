import type { NotificationResponse } from 'expo-notifications';

/** The web build receives no pushes, so no push was ever tapped. */
export function useLastResponse(): NotificationResponse | null | undefined {
  return null;
}
