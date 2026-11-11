'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';

import { useHasReviewText, useReviewText } from './use-guest-signals';

/**
 * The words of a review woom does not keep (a stay before the texts' line,
 * or texts off), read from Hostaway when the manager asks — the original, as
 * in Hostaway — and held by this page alone (docs/guest-review-text.md).
 */
export function TextFromPms({ signalId }: { signalId: string }) {
  const { t } = useTranslation();
  // A row back on screen (another page, another tab) shows what this page read.
  const isRead = useHasReviewText(signalId);
  const [asked, setAsked] = useState(isRead);
  const text = useReviewText(signalId, asked);
  if (!asked) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setAsked(true)}
      >
        {t('panel.guests.liveText.show')}
      </Button>
    );
  }
  if (text.isPending) {
    return (
      <p className="mt-2 text-muted-foreground" aria-live="polite">
        {t('panel.guests.liveText.loading')}
      </p>
    );
  }
  if (text.isError) {
    // The limit and the PMS both say «try again»: the button is here, the
    // read is the manager's to repeat (each one is counted).
    return (
      <div className="mt-2 flex flex-col items-start gap-2">
        <ErrorState error={text.error} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={text.isFetching}
          onClick={() => void text.refetch()}
        >
          {t('panel.guests.liveText.retry')}
        </Button>
      </div>
    );
  }
  const { public_text: publicText, private_text: privateText } = text.data;
  const comments = Object.entries(text.data.category_comments);
  const isEmpty = publicText === null && privateText === null && comments.length === 0;
  return (
    <div className="mt-2 flex flex-col gap-1" aria-live="polite">
      <p className="text-xs text-muted-foreground">{t('panel.guests.liveText.note')}</p>
      {isEmpty ? <p>{t('panel.guests.liveText.empty')}</p> : null}
      {publicText === null ? null : <p className="whitespace-pre-line">{publicText}</p>}
      {privateText === null ? null : (
        <p className="whitespace-pre-line">
          <span className="text-xs text-muted-foreground">
            {t('panel.guests.card.privateOnly')}{' '}
          </span>
          {privateText}
        </p>
      )}
      {comments.map(([category, comment]) => (
        <p key={category} className="whitespace-pre-line">
          <span className="text-xs text-muted-foreground">
            {t(`panel.guests.category.${category}`)}:{' '}
          </span>
          {comment}
        </p>
      ))}
    </div>
  );
}
