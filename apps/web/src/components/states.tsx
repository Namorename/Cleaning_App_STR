'use client';

import type { ComponentProps } from 'react';

import { serverErrorKey, serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

/**
 * The three states of a list or a card (5.2): loading, empty, failed. Today
 * each is one line of the screen's own words; the redesign of the screens
 * (5.4) changes how they look here, once, instead of in sixty places.
 */

/** Still loading: one quiet line. */
export function LoadingState({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="loading-state"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

/** Nothing to show: one quiet line. */
export function EmptyState({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="empty-state"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

interface ErrorStateProps {
  /** The screen's sentence («Не удалось загрузить уборки»); the general phrase when none. */
  message?: string;
  /** What failed, as supabase-js handed it over. */
  error: unknown;
  className?: string;
}

/**
 * Something did not load (CLAUDE.md): a translated sentence leads — the
 * screen's, or the general phrase — and under it, small, what the server
 * said: its refusal in the reader's language when it sent a key this build
 * knows, its own English words when it did not, for the manager to pass on.
 */
export function ErrorState({ message, error, className }: ErrorStateProps) {
  const failure = serverErrorText(error);
  const hasKey = serverErrorKey(error) !== null;
  const detail = message !== undefined && hasKey ? failure.text : failure.detail;

  return (
    <div role="alert" data-slot="error-state" className={cn('text-sm text-destructive', className)}>
      <p>{message ?? failure.text}</p>
      {detail === null ? null : <p className="text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}
