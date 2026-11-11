'use client';

import {
  canRetryGuestMessage,
  formatGuestMessageTime,
  guestMessageFailure,
  type GuestMessage,
  type GuestMessageAsk,
} from '@str-ops/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { useGuestMessage } from './use-guest-message';

interface GuestMessageBlockProps {
  ask: GuestMessageAsk;
  className?: string;
}

/**
 * «Сообщение гостя» on a task from a chat and on a chat's card of «Гости» (owner, 2026-11-11): the
 * message the card was raised on, and the guest's words around it, read from Hostaway when the
 * manager presses the button — never before, and kept by nobody: the page holds it in memory, the
 * note says so. Each state has its own words: loading, the messages, the term over, Hostaway down,
 * no rights, the limit.
 */
export function GuestMessageBlock({ ask, className }: GuestMessageBlockProps) {
  const { t } = useTranslation();
  const [isAsked, setAsked] = useState(false);
  const read = useGuestMessage(ask, isAsked);

  return (
    <section
      aria-label={t('problems.guestMessage.title')}
      className={cn('flex flex-col gap-1', className)}
    >
      <h2 className="font-medium">{t('problems.guestMessage.title')}</h2>
      {!isAsked ? (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setAsked(true)}>
            {t('problems.guestMessage.show')}
          </Button>
        </div>
      ) : read.isPending ? (
        <p className="text-muted-foreground" aria-live="polite">
          {t('problems.guestMessage.loading')}
        </p>
      ) : read.isError ? (
        <Failure
          hint={(read.error as { hint?: string }).hint}
          isRetrying={read.isFetching}
          onRetry={() => void read.refetch()}
        />
      ) : (
        <Messages messages={read.data} />
      )}
    </section>
  );
}

interface FailureProps {
  hint: string | undefined;
  isRetrying: boolean;
  onRetry: () => void;
}

/** The state in words; a button to ask again where asking again may help. */
function Failure({ hint, isRetrying, onRetry }: FailureProps) {
  const { t } = useTranslation();
  const failure = guestMessageFailure(hint);
  return (
    <div className="flex flex-col items-start gap-2" data-state={failure}>
      <p role="status" className="text-muted-foreground">
        {t(`problems.guestMessage.${failure}`)}
      </p>
      {canRetryGuestMessage(failure) ? (
        <Button type="button" variant="outline" size="sm" disabled={isRetrying} onClick={onRetry}>
          {t('problems.guestMessage.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** The messages in the order sent, each with its day and time; the flagged one says so. */
function Messages({ messages }: { messages: readonly GuestMessage[] }) {
  const { t } = useTranslation();
  const language = useLanguage();
  return (
    <div className="flex flex-col gap-2" aria-live="polite" data-state="shown">
      <p className="text-xs text-muted-foreground">{t('problems.guestMessage.note')}</p>
      <ol className="flex flex-col gap-2">
        {messages.map((message) => (
          <li
            key={message.sent_at}
            data-flagged={message.is_flagged ? 'true' : undefined}
            className={cn(
              'flex flex-col gap-0.5 rounded-md border px-3 py-2',
              message.is_flagged ? 'border-foreground/40' : 'border-dashed',
            )}
          >
            <span className="text-xs text-muted-foreground">
              <time dateTime={message.sent_at}>
                {formatGuestMessageTime(message.sent_at, language)}
              </time>
              {message.is_flagged ? ` · ${t('problems.guestMessage.flagged')}` : ''}
              {message.text !== null && message.attachments > 0
                ? ` · ${t('problems.guestMessage.files', { count: message.attachments })}`
                : ''}
            </span>
            {message.text === null ? (
              <span className="text-muted-foreground">
                {t('problems.guestMessage.noText', { count: message.attachments })}
              </span>
            ) : (
              <p className="whitespace-pre-line">{message.text}</p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
