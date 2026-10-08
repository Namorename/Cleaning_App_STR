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
 * The bubbles (5.4, «Чат»): own ones in the primary family — its tonal fill
 * and a primary-tinted frame — others in the neutral muted one; the words on
 * both hold 4.5:1 in either theme (the sheet's test measures it). Before,
 * the two differed by a faint background alone.
 */
const OWN_BUBBLE = 'self-end border-primary/40 bg-secondary';
const OTHERS_BUBBLE = 'self-start border-border bg-muted';

/**
 * The transcript: who said what, and when. Own messages keep to the right.
 *
 * It fills the height its parent leaves it (the chat sheet, under the
 * heading and over the composer) and scrolls on its own; it opens on the
 * newest message and follows the conversation as it grows.
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
    <div ref={box} className="min-h-0 flex-1 overflow-y-auto">
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
                isOwn ? OWN_BUBBLE : OTHERS_BUBBLE,
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
