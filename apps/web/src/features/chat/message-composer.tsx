'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import { CHAT_BODY_MAX_LENGTH, type ChatSubject } from './schema';
import { useSendMessage } from './use-chat';

interface MessageComposerProps {
  subject: ChatSubject;
}

/**
 * The box a manager writes in.
 *
 * The message id is minted when the draft starts and replaced only once the
 * server has accepted it: a retry after a failed send replays the same id,
 * and the server answers with the same row rather than a second one.
 */
export function MessageComposer({ subject }: MessageComposerProps) {
  const { t } = useTranslation();
  const send = useSendMessage(subject);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState('');

  const isEmpty = body.trim() === '';
  const failure = send.isError ? serverErrorText(send.error) : null;

  const submit = () => {
    if (isEmpty || send.isPending) {
      return;
    }
    send.mutate(
      { id: draftId, body },
      {
        onSuccess: () => {
          setBody('');
          setDraftId(crypto.randomUUID());
        },
      },
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  // Enter alone makes a new line: a message to a cleaner is often a list.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Textarea
        aria-label={t('panel.chat.placeholder')}
        placeholder={t('panel.chat.placeholder')}
        value={body}
        maxLength={CHAT_BODY_MAX_LENGTH}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={isEmpty || send.isPending}>
          {send.isPending ? t('panel.chat.sending') : t('panel.chat.send')}
        </Button>
        <span className="text-xs text-muted-foreground">{t('panel.chat.sendHint')}</span>
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}
