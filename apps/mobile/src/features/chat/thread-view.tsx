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
import type { LocalMediaRecord, LocalMediaStore } from '@/features/media/local-store';
import { MediaStrip } from '@/features/media/media-strip';
import { formatReportedAt } from '@/features/problems/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

import { AttachButtons } from './attach-buttons';
import { messageTiles, type MessageTile, type OwnMediaStates } from './media-tiles';
import { MessageMedia } from './message-media';
import {
  CHAT_BODY_MAX_LENGTH,
  CHAT_MAX_PHOTOS,
  isOwnMessage,
  isPastUploadWindow,
  type ChatMessage,
  type PendingMessage,
} from './schema';

interface ThreadViewProps {
  /** Oldest first. Undefined while the first load is in flight. */
  messages?: readonly ChatMessage[];
  /** Said from this phone, not yet confirmed by the server. */
  pending: readonly PendingMessage[];
  currentUserId: string;
  /** A failure to open or read the thread, or to send; shown above the box. */
  error: Error | null;
  /** A capture that did not happen, in her language; shown where the error is. */
  notice?: string | null;
  onSend: (body: string) => void;
  /** What this phone's queue says about the photos of its own messages. */
  ownMedia?: OwnMediaStates;
  /** The files this phone still has, by media id. */
  local?: LocalMediaStore;
  /** Signed links for the photos it does not, by storage path. */
  urls?: Readonly<Record<string, string>>;
  onRetryMedia?: (mediaId: string, messageId: string) => void;
  onRemoveMedia?: (mediaId: string, messageId: string) => void;
  /** The photos chosen for the next message, not sent yet. */
  drafts?: readonly LocalMediaRecord[];
  /** Absent: the box takes words only. */
  onTakePhoto?: () => void;
  onPickPhoto?: () => void;
  onDiscardDraft?: (mediaId: string) => void;
  isCapturing?: boolean;
}

/** A row of the transcript: a message the server has, or one still on its way. */
type Row =
  | { kind: 'message'; key: string; message: ChatMessage; tiles: MessageTile[] }
  | { kind: 'pending'; key: string; body: string; tiles: MessageTile[] };

interface TileSources {
  currentUserId: string;
  ownMedia: OwnMediaStates;
  local: LocalMediaStore;
  urls: Readonly<Record<string, string>>;
}

function rowsOf(
  messages: readonly ChatMessage[],
  pending: readonly PendingMessage[],
  sources: TileSources,
): Row[] {
  const { currentUserId, ownMedia, local, urls } = sources;
  const sent = new Set(messages.map((message) => message.id));
  return [
    ...messages.map<Row>((message) => ({
      kind: 'message',
      key: message.id,
      message,
      tiles: messageTiles(
        message.id,
        message.body,
        message.task_media,
        isOwnMessage(message, currentUserId),
        ownMedia,
        local,
        urls,
        isPastUploadWindow(message.created_at),
      ),
    })),
    // A pending message the server has meanwhile confirmed is already above.
    ...pending
      .filter((item) => !sent.has(item.id))
      .map<Row>((item) => ({
        kind: 'pending',
        key: item.id,
        body: item.body,
        // Just written on this phone: nothing about it is late yet.
        tiles: messageTiles(item.id, item.body, [], true, ownMedia, local, urls, false),
      })),
  ];
}

const NO_OWN_MEDIA: OwnMediaStates = new Map();
const NO_LOCAL: LocalMediaStore = {};
const NO_URLS: Readonly<Record<string, string>> = {};
const NO_DRAFTS: readonly LocalMediaRecord[] = [];

/**
 * The conversation about a subject, and the box to answer in.
 *
 * Presentational: the route opens the thread, polls and marks read. What she
 * has just said appears at once, greyed, and stays there through a stairwell
 * without signal; the server's copy replaces it when the send goes through.
 * Photos chosen for the next message sit above the box until she sends.
 */
export function ThreadView({
  messages,
  pending,
  currentUserId,
  error,
  notice = null,
  onSend,
  ownMedia = NO_OWN_MEDIA,
  local = NO_LOCAL,
  urls = NO_URLS,
  onRetryMedia,
  onRemoveMedia,
  drafts = NO_DRAFTS,
  onTakePhoto,
  onPickPhoto,
  onDiscardDraft,
  isCapturing = false,
}: ThreadViewProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [body, setBody] = useState('');

  // Newest at the bottom, drawn from the bottom: an inverted list opens on
  // the latest message with no scroll-to-end and stays put while it polls.
  const rows =
    messages === undefined
      ? []
      : rowsOf(messages, pending, { currentUserId, ownMedia, local, urls }).reverse();
  const failure = error === null ? null : serverErrorText(error);
  const isEmpty = body.trim() === '' && drafts.length === 0;

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
                tiles={item.tiles}
                isOwn={isOwnMessage(item.message, currentUserId)}
                onRetryMedia={onRetryMedia}
                onRemoveMedia={onRemoveMedia}
                styles={styles}
              />
            ) : (
              <View
                accessibilityLabel={t('chat.pending')}
                style={[styles.bubble, styles.bubbleOwn, styles.bubblePending]}
              >
                {item.body !== '' ? <Text style={styles.body}>{item.body}</Text> : null}
                <MessageMedia tiles={item.tiles} />
                <Text style={styles.time}>{t('chat.pending')}</Text>
              </View>
            )
          }
        />
      )}

      {failure !== null || notice !== null ? (
        <View accessibilityLiveRegion="polite" style={styles.failure}>
          <Text style={styles.error}>{failure?.text ?? notice}</Text>
          {failure?.detail != null ? (
            // Raw words for passing on; a long report must not push the box away.
            <Text style={styles.errorDetail} numberOfLines={3}>
              {failure.detail}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* The chosen photos take room only once there are any. */}
      {drafts.length > 0 ? (
        <View style={styles.drafts}>
          <MediaStrip
            items={drafts.map((draft) => ({ id: draft.id, uri: draft.uri, status: 'local' }))}
            maxCount={CHAT_MAX_PHOTOS}
            onRemove={onDiscardDraft}
          />
        </View>
      ) : null}

      <View style={styles.composer}>
        {onTakePhoto !== undefined ? (
          <AttachButtons
            taken={drafts.length}
            max={CHAT_MAX_PHOTOS}
            onTakePhoto={onTakePhoto}
            onPickPhoto={onPickPhoto}
            isCapturing={isCapturing}
          />
        ) : null}
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
  tiles: readonly MessageTile[];
  isOwn: boolean;
  onRetryMedia?: (mediaId: string, messageId: string) => void;
  onRemoveMedia?: (mediaId: string, messageId: string) => void;
  styles: ReturnType<typeof createStyles>;
}

function MessageBubble({
  message,
  tiles,
  isOwn,
  onRetryMedia,
  onRemoveMedia,
  styles,
}: MessageBubbleProps) {
  const { t } = useTranslation();
  const author = message.author_name ?? t('chat.unknownAuthor');

  return (
    <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
      {isOwn ? null : <Text style={styles.author}>{author}</Text>}
      {message.body !== '' ? <Text style={styles.body}>{message.body}</Text> : null}
      <MessageMedia
        tiles={tiles}
        onRetry={
          isOwn && onRetryMedia !== undefined
            ? (mediaId) => onRetryMedia(mediaId, message.id)
            : undefined
        }
        onRemove={
          isOwn && onRemoveMedia !== undefined
            ? (mediaId) => onRemoveMedia(mediaId, message.id)
            : undefined
        }
      />
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
    drafts: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.divider,
      backgroundColor: theme.card,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Spacing.sm,
      padding: Spacing.md,
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
