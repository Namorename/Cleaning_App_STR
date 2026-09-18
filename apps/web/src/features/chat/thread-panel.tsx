'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { serverErrorText } from '@/lib/server-error';

import { MessageComposer } from './message-composer';
import { MessageList } from './message-list';
import { newestMessageAt, type ChatMessage, type ChatSubject } from './schema';
import {
  useCurrentUserId,
  useMarkThreadRead,
  useMessages,
  usePhotoUrls,
  useThread,
} from './use-chat';
import { useOutgoingPhotos } from './use-outgoing-photos';

interface ThreadPanelProps {
  subject: ChatSubject;
}

/**
 * The conversation about a subject, inside its card.
 *
 * Opening the panel opens the thread (the server finds or creates it), draws
 * what has been said and marks read exactly what was drawn, not everything
 * that exists. The audience is the audience of the subject; the line under
 * the heading says so, because a manager writing to an unclaimed task should
 * know who will see it.
 */
export function ThreadPanel({ subject }: ThreadPanelProps) {
  const { t } = useTranslation();
  const thread = useThread(subject);

  const audience =
    'taskId' in subject ? t('panel.chat.audienceTask') : t('panel.chat.audienceProblem');

  return (
    <section aria-label={t('panel.chat.title')} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium">{t('panel.chat.title')}</h3>
        <p className="text-xs text-muted-foreground">{audience}</p>
      </div>
      {thread.isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.chat.loading')}</p>
      ) : thread.isError ? (
        <ThreadError error={thread.error} />
      ) : (
        <Thread threadId={thread.data.id} subject={subject} />
      )}
    </section>
  );
}

function ThreadError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const failure = serverErrorText(error);
  return (
    <p role="alert" className="text-sm text-destructive">
      {t('panel.chat.loadError')}
      <span className="block text-xs text-muted-foreground">{failure.detail ?? failure.text}</span>
    </p>
  );
}

/** The paths worth signing: the photos that actually have a file. */
function arrivedPaths(messages: readonly ChatMessage[] | undefined): string[] {
  return (messages ?? []).flatMap((message) =>
    message.task_media.flatMap((photo) => (photo.uploaded_at === null ? [] : [photo.storage_path])),
  );
}

function Thread({ threadId, subject }: { threadId: string; subject: ChatSubject }) {
  const { t } = useTranslation();
  const messages = useMessages(threadId);
  const currentUserId = useCurrentUserId();
  const { mutate: markRead } = useMarkThreadRead();
  const outgoing = useOutgoingPhotos();
  // What has already been reported as read, so a re-render does not repeat it.
  const markedUpTo = useRef<string | null>(null);

  const paths = useMemo(() => arrivedPaths(messages.data), [messages.data]);
  const urls = usePhotoUrls(paths);

  const newest = messages.data === undefined ? null : newestMessageAt(messages.data);

  useEffect(() => {
    if (newest === null || markedUpTo.current === newest) {
      return;
    }
    markedUpTo.current = newest;
    markRead({ threadId, upTo: newest });
  }, [markRead, newest, threadId]);

  return (
    <>
      {messages.isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.chat.loading')}</p>
      ) : messages.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.chat.loadError')}
        </p>
      ) : messages.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.chat.empty')}</p>
      ) : (
        <MessageList
          messages={messages.data}
          currentUserId={currentUserId}
          outgoing={outgoing.states}
          previews={outgoing.previews}
          urls={urls}
          onRetryPhoto={outgoing.retry}
          onRemovePhoto={outgoing.discard}
        />
      )}
      <MessageComposer subject={subject} onSent={outgoing.start} />
    </>
  );
}
