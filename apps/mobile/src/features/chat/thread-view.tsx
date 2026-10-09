import { STATUS_TONE } from '@str-ops/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { FailureText } from '@/components/failure-text';
import { IconButton } from '@/components/icon-button';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text, useFontFace } from '@/components/text';
import { BUTTON_HEIGHT, FontSize, Radius, Spacing, type Theme } from '@/constants/theme';
import type { LocalMediaRecord, LocalMediaStore } from '@/features/media/local-store';
import { MediaStrip } from '@/features/media/media-strip';
import { formatReportedAt } from '@/features/problems/format';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

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
  /** A send that failed; shown above the box, where she tries again. */
  error: Error | null;
  /**
   * A failure to read the messages: the error state while there are none to
   * show, a line above the transcript while the saved ones still are.
   */
  loadError?: Error | null;
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

/** The weight of what she types: the body weight, as in `TextField`. */
const INPUT_WEIGHT = 600;

/** The box grows with her words up to a few lines, then scrolls inside. */
const INPUT_MAX_HEIGHT = 140;

/**
 * The conversation about a subject, and the box to answer in.
 *
 * Presentational: the route opens the thread, polls and marks read. What she
 * has just said appears at once in a dashed bubble, and stays there through a
 * stairwell without signal; the server's copy replaces it when the send goes
 * through. Photos chosen for the next message sit above the box until she
 * sends. The box stays whatever the transcript is doing: a message written
 * while the thread cannot load waits in the queue like any other.
 */
export function ThreadView({
  messages,
  pending,
  currentUserId,
  error,
  loadError = null,
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
  // What she has said is drawn even before, or without, the transcript: a
  // message written while it cannot load must show somewhere.
  const rows = rowsOf(messages ?? [], pending, { currentUserId, ownMedia, local, urls }).reverse();
  const hasNothingToShow = messages === undefined && rows.length === 0;
  const isEmpty = body.trim() === '' && drafts.length === 0;

  const send = () => {
    if (isEmpty) {
      return;
    }
    onSend(body);
    setBody('');
  };

  // The error state only when there is nothing at all to show.
  const transcript = hasNothingToShow ? (
    loadError !== null ? (
      <ErrorState error={loadError} />
    ) : (
      <ThreadSkeleton label={t('chat.loading')} />
    )
  ) : rows.length === 0 ? (
    <EmptyState title={t('chat.empty')} />
  ) : (
    <FlatList
      data={rows}
      inverted
      keyExtractor={(row) => row.key}
      contentContainerStyle={layout.list}
      renderItem={({ item }) =>
        item.kind === 'message' ? (
          <MessageBubble
            message={item.message}
            tiles={item.tiles}
            isOwn={isOwnMessage(item.message, currentUserId)}
            onRetryMedia={onRetryMedia}
            onRemoveMedia={onRemoveMedia}
          />
        ) : (
          <View
            accessibilityLabel={t('chat.pending')}
            style={[layout.bubble, layout.own, styles.pending]}
          >
            {item.body !== '' ? <Text>{item.body}</Text> : null}
            <MessageMedia tiles={item.tiles} />
            <Text variant="caption" tone="secondary">
              {t('chat.pending')}
            </Text>
          </View>
        )
      }
    />
  );

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Error over cache: the saved messages — or only her own on their way —
          stay, the failure is said above them. */}
      {!hasNothingToShow && loadError !== null ? (
        <View style={layout.banner}>
          <ErrorBanner title={t('chat.refreshFailed')} error={loadError} />
        </View>
      ) : null}

      {transcript}

      {error !== null ? (
        <View style={layout.failure}>
          <FailureText error={error} />
        </View>
      ) : notice !== null ? (
        <Text accessibilityLiveRegion="polite" tone="danger" align="center" style={layout.failure}>
          {notice}
        </Text>
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
          <View style={layout.attach}>
            <AttachButtons
              taken={drafts.length}
              max={CHAT_MAX_PHOTOS}
              onTakePhoto={onTakePhoto}
              onPickPhoto={onPickPhoto}
              isCapturing={isCapturing}
            />
          </View>
        ) : null}
        <MessageBox value={body} onChangeText={setBody} />
        <IconButton
          icon="action.send"
          variant="primary"
          size="large"
          accessibilityLabel={t('chat.send')}
          isDisabled={isEmpty}
          onPress={send}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

interface MessageBoxProps {
  value: string;
  onChangeText: (text: string) => void;
}

/**
 * The answer box: one line that grows with her words, drawn as a `TextField`
 * is — the outline that is found, the focus ring while she is in it — without
 * the label above, which a messenger's box does not have; the placeholder names
 * it to the reader.
 */
function MessageBox({ value, onChangeText }: MessageBoxProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const face = useFontFace(INPUT_WEIGHT);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <TextInput
      accessibilityLabel={t('chat.placeholder')}
      placeholder={t('chat.placeholder')}
      placeholderTextColor={theme.textMuted}
      selectionColor={theme.primary}
      value={value}
      onChangeText={onChangeText}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      multiline
      maxLength={CHAT_BODY_MAX_LENGTH}
      style={[styles.input, face, isFocused && styles.inputFocused]}
    />
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  tiles: readonly MessageTile[];
  isOwn: boolean;
  onRetryMedia?: (mediaId: string, messageId: string) => void;
  onRemoveMedia?: (mediaId: string, messageId: string) => void;
}

/** Hers on the primary's light surface at the right, the others' on the card at the left. */
function MessageBubble({ message, tiles, isOwn, onRetryMedia, onRemoveMedia }: MessageBubbleProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const author = message.author_name ?? t('chat.unknownAuthor');

  return (
    <View
      testID={isOwn ? 'own-message' : 'other-message'}
      style={[layout.bubble, isOwn ? [layout.own, styles.own] : [layout.other, styles.other]]}
    >
      {isOwn ? null : (
        <Text variant="caption" tone="secondary" weight={700}>
          {author}
        </Text>
      )}
      {message.body !== '' ? <Text>{message.body}</Text> : null}
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
      <Text variant="caption" tone="secondary">
        {formatReportedAt(message.created_at)}
      </Text>
    </View>
  );
}

/** The skeleton's bubbles: one of theirs, one of hers, one of theirs. */
const SKELETON_BUBBLE = 56;

interface ThreadSkeletonProps {
  /** What is loading, said to the reader. */
  label: string;
}

function ThreadSkeleton({ label }: ThreadSkeletonProps) {
  return (
    <SkeletonGroup label={label} style={layout.skeleton}>
      <Skeleton width="70%" height={SKELETON_BUBBLE} radius={Radius.lg} />
      <Skeleton
        width="55%"
        height={SKELETON_BUBBLE}
        radius={Radius.lg}
        style={layout.skeletonOwn}
      />
      <Skeleton width="60%" height={SKELETON_BUBBLE} radius={Radius.lg} />
    </SkeletonGroup>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  list: { padding: Spacing.lg, gap: Spacing.sm },
  banner: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  skeleton: { flex: 1, justifyContent: 'flex-end', padding: Spacing.lg },
  skeletonOwn: { alignSelf: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  // Hers is told apart by its side as well as its fill.
  own: { alignSelf: 'flex-end' },
  other: { alignSelf: 'flex-start' },
  failure: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xs },
  // The camera and the gallery stand level with a one-line box.
  attach: { minHeight: BUTTON_HEIGHT, justifyContent: 'center' },
});

const createStyles = (theme: Theme) => {
  const onItsWay = theme.tone[STATUS_TONE['chat.pending']];
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    own: {
      backgroundColor: theme.secondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
    },
    other: {
      backgroundColor: theme.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.divider,
    },
    // On its way: its own tone and a dashed frame, not a fade — faded words
    // fall under 4.5:1, and «Отправляется…» says it in words as well.
    pending: {
      backgroundColor: onItsWay.bg,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: onItsWay.border,
    },
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
      minHeight: BUTTON_HEIGHT,
      maxHeight: INPUT_MAX_HEIGHT,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      color: theme.text,
      fontSize: FontSize.body,
      backgroundColor: theme.card,
      textAlignVertical: 'center',
    },
    // Two pixels where one was: the state shows in the width as well as the colour.
    inputFocused: { borderWidth: 2, borderColor: theme.focusRing },
  });
};
