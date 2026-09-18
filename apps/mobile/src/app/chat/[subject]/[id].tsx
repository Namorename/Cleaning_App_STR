import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { CHAT_SUBJECT_KINDS, newestMessageAt, type ChatSubject } from '@/features/chat/schema';
import { ThreadView } from '@/features/chat/thread-view';
import {
  useMarkThreadRead,
  useMessages,
  usePendingMessages,
  useSendMessage,
  useThread,
} from '@/features/chat/use-chat';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

const Params = z.object({ subject: z.enum(CHAT_SUBJECT_KINDS), id: z.string().uuid() });

/**
 * The conversation about a task or a problem. Thin: params in, hooks wired,
 * the screen itself is ThreadView.
 *
 * The thread is opened by the server (found or created), then read; polling
 * runs only while this screen is focused, and what was drawn is reported as
 * read up to its newest message. A send is queued under an id made here, so
 * a stairwell without signal delays it rather than losing or doubling it.
 */
export default function ChatRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  const parsed = Params.safeParse(useLocalSearchParams());
  const subject: ChatSubject | null = parsed.success
    ? { kind: parsed.data.subject, id: parsed.data.id }
    : null;

  const [isFocused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const thread = useThread(subject);
  const threadId = thread.data?.id ?? null;
  const messages = useMessages(threadId, isFocused);
  const pending = usePendingMessages(subject);
  const send = useSendMessage();
  const { mutate: markRead } = useMarkThreadRead();
  const markedUpTo = useRef<string | null>(null);

  const newest = messages.data === undefined ? null : newestMessageAt(messages.data);
  useEffect(() => {
    if (threadId === null || newest === null || markedUpTo.current === newest) {
      return;
    }
    markedUpTo.current = newest;
    markRead({ threadId, upTo: newest });
  }, [markRead, newest, threadId]);

  if (subject === null || userId === null) {
    return <Message text={t('chat.notFound')} styles={styles} />;
  }

  if (thread.error) {
    const failure = serverErrorText(thread.error);
    return <Message text={failure.text} detail={failure.detail} styles={styles} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: t('chat.title') }} />
      <ThreadView
        messages={messages.data}
        pending={pending}
        currentUserId={userId}
        error={send.error ?? messages.error}
        onSend={(body) => send.mutate({ messageId: randomUUID(), body, subject })}
      />
    </>
  );
}

interface MessageProps {
  text: string;
  detail?: string | null;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, detail = null, styles }: MessageProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
      {detail !== null ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
      backgroundColor: theme.background,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    detail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
  });
