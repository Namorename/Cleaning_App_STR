'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';

import type { PdfRequest } from './pdf/report-input';

/** The listings or the team the report names did not load: why, and a way to load them again. */
export interface LookupsFailure {
  error: unknown;
  retry: () => void;
  isRetrying: boolean;
}

interface PdfButtonProps {
  /** The page as it is at the moment of the press. */
  request: () => PdfRequest;
  /** Until the figures and the team have loaded there is nothing to make. */
  disabled: boolean;
  /** Said under the button instead of a silent disabled one (owner, 2026-10-16). */
  lookupsFailed?: LookupsFailure | null;
}

/**
 * «Download PDF»: one press, one file. The PDF code and its fonts are fetched
 * on the first press only — a chunk of their own, not the page's weight.
 */
export function PdfButton({ request, disabled, lookupsFailed = null }: PdfButtonProps) {
  const { t } = useTranslation();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const make = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const { downloadAnalyticsPdf } = await import('./pdf/download');
      await downloadAnalyticsPdf(request());
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={disabled || isBusy}
        onClick={() => void make()}
      >
        {isBusy ? t('panel.analytics.pdf.preparing') : t('panel.analytics.pdf.download')}
      </Button>
      {/* Said aloud: a button that goes disabled loses the keyboard's focus and says nothing. */}
      <span role="status" className="sr-only">
        {isBusy
          ? t('panel.analytics.pdf.preparing')
          : lookupsFailed?.isRetrying === true
            ? t('common.loading')
            : ''}
      </span>
      {error === null ? null : <ErrorState message={t('panel.analytics.pdf.failed')} error={error} />}
      {lookupsFailed === null ? null : (
        <div className="flex flex-col items-end gap-1 text-right">
          <ErrorState message={t('panel.analytics.pdf.lookupsFailed')} error={lookupsFailed.error} />
          {/* Marked busy, not disabled: the press keeps the keyboard's focus while the lists load. */}
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            aria-disabled={lookupsFailed.isRetrying}
            onClick={() => {
              if (!lookupsFailed.isRetrying) {
                lookupsFailed.retry();
              }
            }}
          >
            {lookupsFailed.isRetrying ? t('common.loading') : t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
