'use client';

import { RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { ErrorState } from '@/components/states';
import { Button, buttonVariants } from '@/components/ui/button';

/** What Next hands an error boundary: the thrown error, and the digest of its server log line. */
export type RenderError = Error & { digest?: string };

interface ErrorViewProps {
  error: RenderError;
  /** Next's `retry`: fetch the page again and draw it once more. */
  retry: () => void;
}

/**
 * A page that threw while it was drawn. The panel's sentence leads — the
 * phone's own (`common.screenFailed`) — and under it, small, the error's own
 * English words for the manager to pass on (CLAUDE.md: the raw message is
 * never shown alone), then the digest Next keeps in the server's log. From a
 * server component Next sends only a generic message and that digest.
 */
export function ErrorView({ error, retry }: ErrorViewProps) {
  const { t } = useTranslation();
  const digest = typeof error?.digest === 'string' && error.digest !== '' ? error.digest : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.error.title')} />
      <ErrorState message={t('common.screenFailed')} error={error} />
      {digest === null ? null : (
        <p className="text-xs text-muted-foreground">{t('panel.error.digest', { digest })}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => retry()}>
          <RotateCw aria-hidden="true" />
          {t('common.retry')}
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: 'outline' })}>
          {t('panel.toDashboard')}
        </Link>
      </div>
    </div>
  );
}
