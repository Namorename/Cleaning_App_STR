'use client';

import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { isOwnMessage, type ChatMessage } from './schema';

interface MessageListProps {
  /** Oldest first. */
  messages: readonly ChatMessage[];
  /** Whose messages sit on the right. */
  currentUserId: string | null;
}

/** The transcript: who said what, and when. Own messages keep to the right. */
export function MessageList({ messages, currentUserId }: MessageListProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <ol className="flex flex-col gap-2">
      {messages.map((message) => {
        const isOwn = isOwnMessage(message, currentUserId);
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
            <p className="break-words whitespace-pre-wrap">{message.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
