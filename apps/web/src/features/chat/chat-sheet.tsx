'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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

interface ChatSheetProps {
  subject: ChatSubject;
  /** What the conversation is about: a task's title, or a cleaning's name · place. */
  about: string;
  onClose: () => void;
  /**
   * Where the focus goes when the sheet closes, if what opened it is gone by
   * then — a drawer's «Чат», an item of a menu that closed. Absent, the
   * dialog's own rule.
   */
  returnFocus?: () => HTMLElement | null;
}

/**
 * The conversation about one subject, sliding in from the right (5.4, «Чат»,
 * variant B): the panel of a task or a cleaning, not a section of its own —
 * the list of every conversation comes with layer 6.
 *
 * Opening it opens the thread (the server finds or creates it), draws what
 * has been said and marks read exactly what was drawn, not everything that
 * exists. The audience is the audience of the subject; the line under the
 * heading says so, because a manager writing to an unclaimed task should know
 * who will see it.
 *
 * The transcript takes the height of the sheet and scrolls on its own, the
 * composer under it. On a phone the sheet is the whole width (decision 14).
 */
export function ChatSheet({ subject, about, onClose, returnFocus }: ChatSheetProps) {
  const { t } = useTranslation();
  const audience =
    'taskId' in subject ? t('panel.chat.audienceTask') : t('panel.chat.audienceProblem');
  // What had the focus as the sheet came: the dialog hands it back there, and
  // when it has left the page meanwhile, to what the caller names.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  const finalFocus = (): HTMLElement | boolean => {
    if (opener instanceof HTMLElement && opener.isConnected) {
      return opener;
    }
    return returnFocus?.() ?? true;
  };

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        finalFocus={finalFocus}
        className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle>{t('panel.chat.title')}</SheetTitle>
          <SheetDescription className="font-medium break-words text-foreground">
            {about}
          </SheetDescription>
          <p className="text-xs text-muted-foreground">{audience}</p>
        </SheetHeader>
        <ThreadBody subject={subject} />
      </SheetContent>
    </Sheet>
  );
}

/** The thread of the subject, once the server has found or made it. */
function ThreadBody({ subject }: { subject: ChatSubject }) {
  const { t } = useTranslation();
  const thread = useThread(subject);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {thread.isPending ? (
        <LoadingState>{t('panel.chat.loading')}</LoadingState>
      ) : thread.isError ? (
        <ErrorState message={t('panel.chat.loadError')} error={thread.error} />
      ) : (
        <Thread threadId={thread.data.id} subject={subject} />
      )}
    </div>
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
        <LoadingState className="flex-1">{t('panel.chat.loading')}</LoadingState>
      ) : messages.isError ? (
        <ErrorState className="flex-1" message={t('panel.chat.loadError')} error={messages.error} />
      ) : messages.data.length === 0 ? (
        <EmptyState className="flex-1">{t('panel.chat.empty')}</EmptyState>
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
