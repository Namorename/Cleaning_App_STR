'use client';

import { ErrorView, type RenderError } from '@/components/error-view';

interface PanelErrorProps {
  error: RenderError;
  retry: () => void;
}

/**
 * A panel page that threw while it was drawn: in its place inside the shell,
 * so the menu still leads elsewhere. The layout above it is not covered — an
 * error there reaches the root's `error.tsx`.
 */
export default function PanelError({ error, retry }: PanelErrorProps) {
  return <ErrorView error={error} retry={retry} />;
}
