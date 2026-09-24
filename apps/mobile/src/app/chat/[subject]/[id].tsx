import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import type { SendMessageVariables } from '@/features/chat/api';
import {
  CHAT_MAX_PHOTOS,
  CHAT_SUBJECT_KINDS,
  newestMessageAt,
  type ChatSubject,
} from '@/features/chat/schema';
import { ThreadView } from '@/features/chat/thread-view';
import {
  useMarkThreadRead,
  useMessages,
  usePendingMessages,
  useSendMessage,
  useThread,
} from '@/features/chat/use-chat';
import { capturePhoto, pickPhotoFromGallery, type MediaSource } from '@/features/media/capture';
import { attachFailure } from '@/features/media/failure';
import { toLocalRecord, type LocalMediaRecord } from '@/features/media/local-store';
import {
  useAttachMedia,
  useDiscardLocalMedia,
  useLocalMedia,
  useMediaUrls,
  useOwnMediaStates,
  useRememberLocalMedia,
  useRemoveMedia,
  type AttachMediaVariables,
} from '@/features/media/use-media';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

const Params = z.object({ subject: z.enum(CHAT_SUBJECT_KINDS), id: z.string().uuid() });

// A thread that cannot be drawn fails here, under the header and its way back,
// not at the root: the rest of the app stays where she left it.
export { RouteError as ErrorBoundary } from '@/components/route-error';

/**
 * The conversation about a task or a problem. Thin: params in, hooks wired,
 * the screen itself is ThreadView.
 *
 * The thread is opened by the server (found or created), then read; polling
 * runs only while this screen is focused, and what was drawn is reported as
 * read up to its newest message. A send is queued under an id made here, so
 * a stairwell without signal delays it rather than losing or doubling it.
 *
 * Photos go the way a step's do: kept on the phone first, then handed to the
 * upload queue one by one. Each queued photo says the message again before
 * registering (docs/chat-plan.md, layer 5): the text has its own queue, and
 * a photo must never run ahead of the message it belongs to. The gallery is
 * always offered here — the switch guards a step's evidence, and the office
 * attaches from a browser that has no camera at all.
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

  const attach = useAttachMedia();
  const removeMedia = useRemoveMedia();
  const rememberLocal = useRememberLocalMedia();
  const discardLocal = useDiscardLocalMedia();
  const local = useLocalMedia();
  const ownMedia = useOwnMediaStates();
  const [drafts, setDrafts] = useState<LocalMediaRecord[]>([]);
  const [isCapturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // A signed link is only worth asking for when the phone no longer has the file.
  const remotePaths = useMemo(
    () =>
      (messages.data ?? [])
        .flatMap((message) => message.task_media)
        .filter((row) => row.uploaded_at !== null && local.data?.[row.id] === undefined)
        .map((row) => row.storage_path),
    [messages.data, local.data],
  );
  const urls = useMediaUrls(remotePaths);

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

  const attachFrom = async (source: MediaSource) => {
    if (isCapturing || drafts.length >= CHAT_MAX_PHOTOS) {
      return;
    }
    setCapturing(true);
    setNotice(null);
    try {
      const captured = source === 'gallery' ? await pickPhotoFromGallery() : await capturePhoto();
      if (captured === null) {
        return;
      }
      const record = toLocalRecord(captured);
      await rememberLocal(record);
      setDrafts((current) => [...current, record]);
    } catch (error: unknown) {
      setNotice(attachFailure(error, t));
    } finally {
      setCapturing(false);
    }
  };

  const discardDraft = (mediaId: string) => {
    const record = drafts.find((draft) => draft.id === mediaId);
    setDrafts((current) => current.filter((draft) => draft.id !== mediaId));
    if (record !== undefined) {
      void discardLocal(record);
    }
  };

  const onSend = (body: string) => {
    const message: SendMessageVariables = {
      messageId: randomUUID(),
      body,
      subject,
      mediaExpected: drafts.length,
    };
    send.mutate(message);
    drafts.forEach((record) => {
      attach.mutate(attachVariables(record, message.messageId, message));
    });
    setDrafts([]);
  };

  const onRetryMedia = (mediaId: string, messageId: string) => {
    const record = local.data?.[mediaId];
    if (record !== undefined) {
      attach.mutate(attachVariables(record, messageId));
    }
  };

  // The title comes from the root layout, where the route is declared.
  return (
    <ThreadView
      messages={messages.data}
      pending={pending}
      currentUserId={userId}
      error={send.error ?? messages.error}
      notice={notice}
      onSend={onSend}
      ownMedia={ownMedia}
      local={local.data}
      urls={urls.data}
      onRetryMedia={onRetryMedia}
      onRemoveMedia={(mediaId, messageId) => removeMedia.mutate({ messageId, mediaId })}
      drafts={drafts}
      onTakePhoto={() => void attachFrom('camera')}
      onPickPhoto={() => void attachFrom('gallery')}
      onDiscardDraft={discardDraft}
      isCapturing={isCapturing}
    />
  );
}

/** What the queue needs to register, upload and confirm one kept photo. */
function attachVariables(
  record: LocalMediaRecord,
  messageId: string,
  message?: SendMessageVariables,
): AttachMediaVariables {
  return {
    messageId,
    message,
    uri: record.uri,
    mediaId: record.id,
    kind: record.kind,
    mimeType: record.mimeType,
    byteSize: record.byteSize,
    width: record.width,
    height: record.height,
    durationSec: record.durationSec,
    takenAt: record.takenAt,
    source: record.source,
  };
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
