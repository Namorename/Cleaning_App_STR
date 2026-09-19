'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { MessageMedia } from './message-media';
import { messageTiles, type OutgoingPhotoStates } from './message-tiles';
import { isPastUploadWindow } from './schema';
import { isOwnMessage, type ChatMessage } from './schema';

interface MessageListProps {
  /** Oldest first. */
  messages: readonly ChatMessage[];
  /** Whose messages sit on the right. */
  currentUserId: string | null;
  /** What this panel's own uploads are doing, by media id. */
  outgoing: OutgoingPhotoStates;
  /** Object URLs of files being uploaded, by media id. */
  previews: Readonly<Record<string, string>>;
  /** Signed links for the photos that have arrived, by storage path. */
  urls: ReadonlyMap<string, string>;
  onRetryPhoto: (mediaId: string) => void;
  onRemovePhoto: (mediaId: string, hasRow: boolean) => void;
}

/**
 * The transcript: who said what, and when. Own messages keep to the right.
 *
 * Boxed to a fixed height with its own scroll, so a long conversation does
 * not stretch the card it sits in; the box opens on the newest message and
 * follows the conversation as it grows.
 */
export function MessageList({
  messages,
  currentUserId,
  outgoing,
  previews,
  urls,
  onRetryPhoto,
  onRemovePhoto,
}: MessageListProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const box = useRef<HTMLDivElement>(null);
  const newestId = messages.length === 0 ? null : messages[messages.length - 1].id;

  useEffect(() => {
    const element = box.current;
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
    }
  }, [newestId]);

  return (
    <div ref={box} className="max-h-96 overflow-y-auto rounded-md border p-2">
      <ol className="flex flex-col gap-2">
        {messages.map((message) => {
          const isOwn = isOwnMessage(message, currentUserId);
          const tiles = messageTiles({
            messageId: message.id,
            body: message.body,
            rows: message.task_media,
            isOwn,
            outgoing,
            previews,
            urls,
            pastUploadWindow: isPastUploadWindow(message.created_at),
          });
          return (
            <li
              key={message.id}
              className={cn(
                'flex max-w-[85%] flex-col gap-1 rounded-md border p-3 text-sm',
                isOwn ? 'self-end bg-primary/5' : 'self-start bg-muted/40',
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <Person
                  name={message.author_name}
                  role={message.author_role}
                  fallback={t('panel.chat.unknownAuthor')}
                  className="font-medium text-foreground"
                />
                <time dateTime={message.created_at}>
                  {formatDateTime(message.created_at, language)}
                </time>
              </div>
              {message.body === '' ? null : (
                <p className="break-words whitespace-pre-wrap">{message.body}</p>
              )}
              <MessageMedia
                tiles={tiles}
                onRetry={isOwn ? onRetryPhoto : undefined}
                onRemove={isOwn ? onRemovePhoto : undefined}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
