import { PermissionExplainer } from '@/features/push/permission-explainer';

// A failure here stays under the modal's header, not at the root.
export { RouteError as ErrorBoundary } from '@/components/route-error';

/**
 * Why the app wants to send notifications, shown once a run before the system
 * asks (features/push/hooks.ts, usePermissionPrompt). Thin: the screen is
 * PermissionExplainer.
 */
export default function NotificationsRoute() {
  return <PermissionExplainer />;
}
