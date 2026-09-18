import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { formatReportedAt } from '@/features/problems/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { CHAT_BODY_MAX_LENGTH, isOwnMessage, type ChatMessage, type PendingMessage } from './schema';

interface ThreadViewProps {
  /** Oldest first. Undefined while the first load is in flight. */
  messages?: readonly ChatMessage[];
  /** Said from this phone, not yet confirmed by the server. */
  pending: readonly PendingMessage[];
  currentUserId: string;
  /** A failure to open or read the thread, or to send; shown above the box. */
  error: Error | null;
  onSend: (body: string) => void;
}

/** A row of the transcript: a message the server has, or one still on its way. */
type Row =
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'pending'; key: string; body: string };

function rowsOf(messages: readonly ChatMessage[], pending: readonly PendingMessage[]): Row[] {
  const sent = new Set(messages.map((message) => message.id));
  return [
    ...messages.map<Row>((message) => ({ kind: 'message', key: message.id, message })),
    // A pending message the server has meanwhile confirmed is already above.
    ...pending
      .filter((item) => !sent.has(item.id))
      .map<Row>((item) => ({ kind: 'pending', key: item.id, body: item.body })),
  ];
}

/**
 * The conversation about a subject, and the box to answer in.
 *
 * Presentational: the route opens the thread, polls and marks read. What she
 * has just said appears at once, greyed, and stays there through a stairwell
 * without signal; the server's copy replaces it when the send goes through.
 */
export function ThreadView({ messages, pending, currentUserId, error, onSend }: ThreadViewProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [body, setBody] = useState('');

  // Newest at the bottom, drawn from the bottom: an inverted list opens on
  // the latest message with no scroll-to-end and stays put while it polls.
  const rows = messages === undefined ? [] : rowsOf(messages, pending).reverse();
  const failure = error === null ? null : serverErrorText(error);
  const isEmpty = body.trim() === '';

  const send = () => {
    if (isEmpty) {
      return;
    }
    onSend(body);
    setBody('');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {messages === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator color={styles.hint.color} />
          <Text style={styles.hint}>{t('chat.loading')}</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.hint}>{t('chat.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          inverted
          keyExtractor={(row) => row.key}
          contentContainerStyle={styles.list}
          renderItem={({ item }) =>
            item.kind === 'message' ? (
              <MessageBubble
                message={item.message}
                isOwn={isOwnMessage(item.message, currentUserId)}
                styles={styles}
              />
            ) : (
              <View
                accessibilityLabel={t('chat.pending')}
                style={[styles.bubble, styles.bubbleOwn, styles.bubblePending]}
              >
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.time}>{t('chat.pending')}</Text>
              </View>
            )
          }
        />
      )}

      {failure !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.failure}>
          <Text style={styles.error}>{failure.text}</Text>
          {failure.detail !== null ? (
            <Text style={styles.errorDetail}>{failure.detail}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          accessibilityLabel={t('chat.placeholder')}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={styles.hint.color}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={CHAT_BODY_MAX_LENGTH}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          accessibilityState={{ disabled: isEmpty }}
          disabled={isEmpty}
          onPress={send}
          style={({ pressed }) => [
            styles.sendButton,
            isEmpty && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.sendText}>{t('chat.send')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  styles: ReturnType<typeof createStyles>;
}

function MessageBubble({ message, isOwn, styles }: MessageBubbleProps) {
  const { t } = useTranslation();
  const author = message.author_name ?? t('chat.unknownAuthor');

  return (
    <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
      {isOwn ? null : <Text style={styles.author}>{author}</Text>}
      <Text style={styles.body}>{message.body}</Text>
      <Text style={styles.time}>{formatReportedAt(message.created_at)}</Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
    },
    list: { padding: Spacing.lg, gap: Spacing.sm },
    hint: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    bubble: {
      maxWidth: '85%',
      borderRadius: Radius.lg,
      padding: Spacing.md,
      gap: Spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
    },
    bubbleOwn: { alignSelf: 'flex-end', backgroundColor: theme.calmSurface },
    bubbleOther: { alignSelf: 'flex-start', backgroundColor: theme.card },
    bubblePending: { opacity: 0.6 },
    author: { color: theme.textSecondary, fontSize: FontSize.caption, fontWeight: '700' },
    body: { color: theme.text, fontSize: FontSize.body },
    time: { color: theme.textSecondary, fontSize: FontSize.caption },
    failure: { paddingHorizontal: Spacing.lg, gap: Spacing.xs },
    error: { color: theme.danger, fontSize: FontSize.body, textAlign: 'center' },
    errorDetail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
      backgroundColor: theme.card,
    },
    input: {
      flex: 1,
      minHeight: MIN_TOUCH_TARGET,
      maxHeight: 140,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      color: theme.text,
      fontSize: FontSize.body,
      backgroundColor: theme.background,
    },
    sendButton: {
      minHeight: MIN_TOUCH_TARGET,
      minWidth: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: { opacity: 0.5 },
    pressed: { opacity: 0.75 },
    sendText: { color: theme.onPrimary, fontSize: FontSize.body, fontWeight: '600' },
  });
