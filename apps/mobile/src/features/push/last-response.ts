import * as Notifications from 'expo-notifications';

/**
 * The last tapped push, as expo-notifications keeps it — on a phone. The web
 * build takes last-response.web.ts: its notifications module has no stored
 * response, and asking for one throws while the tabs draw.
 */
export const useLastResponse: () => Notifications.NotificationResponse | null | undefined =
  Notifications.useLastNotificationResponse;
