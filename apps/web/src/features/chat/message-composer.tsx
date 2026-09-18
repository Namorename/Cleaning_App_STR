'use client';

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import {
  CHAT_BODY_MAX_LENGTH,
  CHAT_MAX_PHOTOS,
  CHAT_PHOTO_MAX_BYTES,
  CHAT_PHOTO_MIME_TYPES,
  isAcceptedPhoto,
  type ChatSubject,
} from './schema';
import { useSendMessage } from './use-chat';
import type { PhotoDraft } from './use-outgoing-photos';

interface MessageComposerProps {
  subject: ChatSubject;
  /**
   * The message is through; these photos go under its id. Ownership of the
   * preview links passes with them — the composer does not revoke them.
   */
  onSent: (messageId: string, drafts: readonly PhotoDraft[]) => void;
}

const BYTES_IN_MB = 1024 * 1024;

/**
 * The box a manager writes in.
 *
 * The message id is minted when the draft starts and replaced only once the
 * server has accepted it: a retry after a failed send replays the same id, and
 * the server answers with the same row rather than a second one. Photos are
 * picked before the send and follow it, never the other way round — the
 * message a photo belongs to has to exist before the photo may be registered.
 */
export function MessageComposer({ subject, onSent }: MessageComposerProps) {
  const { t } = useTranslation();
  const send = useSendMessage(subject);
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState('');
  const [drafts, setDrafts] = useState<readonly PhotoDraft[]>([]);
  const [refused, setRefused] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Whatever is still picked when the thread closes was never handed on.
  const live = useRef<readonly PhotoDraft[]>([]);
  useEffect(() => {
    live.current = drafts;
  }, [drafts]);
  useEffect(
    () => () => {
      for (const draft of live.current) {
        URL.revokeObjectURL(draft.previewUrl);
      }
    },
    [],
  );

  const hasNothingToSay = body.trim() === '' && drafts.length === 0;
  const failure = send.isError ? serverErrorText(send.error) : null;

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    // Let the same file be picked again after it was taken off the draft.
    event.target.value = '';
    if (picked.length === 0) {
      return;
    }
    const accepted = picked.filter(isAcceptedPhoto);
    setRefused(accepted.length < picked.length);
    setDrafts((current) => [
      ...current,
      ...accepted.slice(0, CHAT_MAX_PHOTOS - current.length).map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const unpick = (id: string) => {
    setDrafts((current) => {
      const going = current.find((draft) => draft.id === id);
      if (going !== undefined) {
        URL.revokeObjectURL(going.previewUrl);
      }
      return current.filter((draft) => draft.id !== id);
    });
  };

  const submit = () => {
    if (hasNothingToSay || send.isPending) {
      return;
    }
    const going = drafts;
    send.mutate(
      { id: draftId, body, mediaExpected: going.length },
      {
        onSuccess: () => {
          onSent(draftId, going);
          setBody('');
          setDrafts([]);
          setRefused(false);
          setDraftId(crypto.randomUUID());
        },
      },
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  // Enter alone makes a new line: a message to a cleaner is often a list.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Textarea
        aria-label={t('panel.chat.placeholder')}
        placeholder={t('panel.chat.placeholder')}
        value={body}
        maxLength={CHAT_BODY_MAX_LENGTH}
        rows={3}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {drafts.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2">
          {drafts.map((draft, index) => (
            <li key={draft.id} className="flex w-24 flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob: preview of a picked file */}
              <img
                src={draft.previewUrl}
                alt={t('panel.chat.photoAlt', {
                  index: index + 1,
                  status: t('panel.chat.photoStatus.picked'),
                })}
                className="size-24 rounded-md border object-cover"
              />
              <button
                type="button"
                className="text-left text-xs font-medium text-primary underline-offset-2 hover:underline"
                onClick={() => unpick(draft.id)}
              >
                {t('panel.chat.removePhoto')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        accept={CHAT_PHOTO_MIME_TYPES.join(',')}
        className="sr-only"
        aria-label={t('panel.chat.attachPhoto')}
        onChange={pick}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={hasNothingToSay || send.isPending}>
          {send.isPending ? t('panel.chat.sending') : t('panel.chat.send')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={drafts.length >= CHAT_MAX_PHOTOS}
          onClick={() => picker.current?.click()}
        >
          {t('panel.chat.attachPhoto')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t('panel.chat.photoCount', { taken: drafts.length, max: CHAT_MAX_PHOTOS })}
        </span>
        <span className="text-xs text-muted-foreground">{t('panel.chat.sendHint')}</span>
      </div>
      {refused ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.chat.photoRefused', { limit: CHAT_PHOTO_MAX_BYTES / BYTES_IN_MB })}
        </p>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
    </form>
  );
}
