'use client';

import { serverErrorText } from '@/lib/server-error';

interface LayerAlertProps {
  /** The translated sentence: which layer could not be read. */
  message: string;
  error: unknown;
}

/**
 * A layer that could not be read says so over the grid (docs/f10-plan.md,
 * §1), rather than drawing nothing: an empty layer of bookings reads as free
 * nights, an empty layer of tasks as nothing to do. The server's own words
 * go small underneath, for the manager to pass on (CLAUDE.md).
 */
export function LayerAlert({ message, error }: LayerAlertProps) {
  const failure = serverErrorText(error);
  return (
    <div role="alert" className="text-sm text-destructive">
      <p>{message}</p>
      {failure.detail === null ? null : (
        <p className="text-xs text-muted-foreground">{failure.detail}</p>
      )}
    </div>
  );
}
