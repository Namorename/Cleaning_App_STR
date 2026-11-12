'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format-date';
import { signFile } from '@/lib/media';
import { useSupabase } from '@/lib/supabase/use-client';
import { useLanguage } from '@/lib/use-language';

import { MediaFiles, type FileState } from './media-files';
import { PhotoStage } from './photo-stage';
import { formatVideoDuration } from './schema';
import { VideoStage } from './video-stage';
import { downloadName, type ViewerItem } from './viewer-item';

export interface MediaViewerProps {
  items: readonly ViewerItem[];
  /** The file on screen; always one of `items`. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Closed with this file on screen: its thumbnail takes the focus back. */
  onClose: (itemId: string) => void;
  /** What the set is — a step's name; the viewer's own title when absent. */
  title?: string;
}

const LOADING: FileState = { status: 'loading' };

/** The files held besides the one on screen: the photos either side of it, not a video. */
export function neighbourhood(items: readonly ViewerItem[], index: number): ViewerItem[] {
  const current = items[index];
  if (current === undefined) {
    return [];
  }
  const around = [items[index + 1], items[index - 1]].filter(
    (item): item is ViewerItem => item !== undefined && item.kind === 'photo',
  );
  return [current, ...around];
}

type DownloadState = { itemId: string; status: 'pending' | 'failed' | 'missing' } | null;

/** How long a downloaded file's bytes are kept for the browser to finish saving them. */
const RELEASE_DOWNLOAD_MS = 60_000;

/**
 * Save bytes held in memory under `name`. The link is the page's own object
 * URL, so `download` is honoured and the browser saves without navigating —
 * a signed link never reaches the address bar or the history, whatever
 * storage answers.
 */
function saveFromMemory(objectUrl: string, name: string): void {
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

const BAR = 'bg-popover/95 text-popover-foreground';
const BAR_BUTTON = 'h-11 min-w-11';

/**
 * The one viewer of the panel's photos and videos: over the page, the page
 * dimmed behind it.
 *
 * Closes on Esc, on the close button and on a click on the dark around the
 * file. Focus stays inside while it is open (Base UI's modal dialog) and goes
 * back to the thumbnail of the file last shown (`useMediaViewer`). The arrow
 * keys and the buttons below go through the whole set, «3 из 8».
 *
 * Every file is signed when it is opened and held only in memory
 * (`MediaFiles`); «Скачать» saves the original from memory under
 * `downloadName`, so the page never navigates to a signed link.
 */
export function MediaViewer({ items, index, onIndexChange, onClose, title }: MediaViewerProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const client = useSupabase();
  const [files] = useState(() => new MediaFiles({ sign: (path) => signFile(client, path) }));
  const states = useSyncExternalStore(files.subscribe, files.getSnapshot, files.getSnapshot);
  const [download, setDownload] = useState<DownloadState>(null);
  const [resumeAt, setResumeAt] = useState<ReadonlyMap<string, number>>(() => new Map());
  const closeButton = useRef<HTMLButtonElement>(null);

  const item = items[index];
  const count = items.length;
  const position = index + 1;
  const wantedKey = neighbourhood(items, index)
    .map((file) => file.id)
    .join(' ');

  const hold = useEffectEvent(() => files.keep(neighbourhood(items, index)));
  useEffect(() => {
    hold();
  }, [wantedKey]);
  useEffect(() => () => files.clear(), [files]);

  const go = (to: number) => {
    if (to >= 0 && to < count) {
      onIndexChange(to);
    }
  };
  const close = () => onClose(item.id);

  // Heard on the window, before anything on the page (capture), not on the
  // popup: wherever the focus stands — the page behind takes none while the
  // viewer is open — the arrows walk the set.
  const onKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    // A focused player keeps its own arrows: they move through the video;
    // Alt+← is the browser's «Back».
    if (
      event.target instanceof HTMLVideoElement ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(index + 1);
    }
  });
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.hasAttribute('data-viewer-backdrop')) {
      close();
    }
  };

  /**
   * The original file, saved under `downloadName`: a photo from the bytes the
   * viewer already holds, anything else fetched now into memory first. An
   * answer that comes late changes nothing about another file's download.
   */
  const save = async () => {
    const file = item;
    const name = downloadName(file, position);
    const held = states.get(file.id);
    const settle = (next: DownloadState) =>
      setDownload((current) => (current?.itemId === file.id ? next : current));
    setDownload({ itemId: file.id, status: 'pending' });
    try {
      if (file.kind === 'photo' && held?.status === 'ready') {
        saveFromMemory(held.src, name);
        settle(null);
        return;
      }
      const signed = await signFile(client, file.path);
      if (signed.status === 'missing') {
        settle({ itemId: file.id, status: 'missing' });
        return;
      }
      const response = await fetch(signed.url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`storage answered ${response.status}`);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      saveFromMemory(objectUrl, name);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), RELEASE_DOWNLOAD_MS);
      settle(null);
    } catch {
      settle({ itemId: file.id, status: 'failed' });
    }
  };

  const state = states.get(item.id) ?? LOADING;
  const shownDownload = download?.itemId === item.id ? download : null;
  const isSaving = shownDownload?.status === 'pending';
  const isDownloadUnavailable = isSaving || state.status === 'deleted';
  const counter = t('panel.media.viewer.counter', { index: position, count });
  const duration = item.kind === 'video' ? formatVideoDuration(item.durationSec ?? null) : null;
  const itemLabel = t(
    item.kind === 'video' ? 'panel.media.viewer.videoLabel' : 'panel.media.viewer.photoAlt',
    { index: position, count },
  );

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 motion-safe:duration-150 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0" />
        <DialogPrimitive.Popup
          initialFocus={closeButton}
          finalFocus={false}
          data-slot="media-viewer"
          className="fixed inset-0 z-50 flex flex-col text-sm outline-none motion-safe:duration-150 motion-safe:data-open:animate-in motion-safe:data-open:fade-in-0"
          onClick={onClick}
        >
          <header className={`flex items-center gap-2 border-b px-2 py-1 sm:px-4 ${BAR}`}>
            <div className="flex min-w-0 flex-1 flex-col">
              <DialogPrimitive.Title className="truncate font-medium">
                {title ?? t('panel.media.viewer.title')}
              </DialogPrimitive.Title>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {counter}
              </p>
            </div>
            {/* Unavailable rather than disabled while it works: a disabled button
                drops the focus it holds out of the viewer. */}
            <Button
              type="button"
              variant="outline"
              className={`${BAR_BUTTON} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
              aria-label={t('panel.media.viewer.download')}
              title={t('panel.media.viewer.download')}
              aria-disabled={isDownloadUnavailable || undefined}
              aria-busy={isSaving || undefined}
              onClick={isDownloadUnavailable ? undefined : () => void save()}
            >
              {isSaving ? (
                <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
              ) : (
                <Download aria-hidden="true" />
              )}
              <span className="hidden sm:inline">{t('panel.media.viewer.download')}</span>
            </Button>
            <DialogPrimitive.Close
              ref={closeButton}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  className={BAR_BUTTON}
                  aria-label={t('panel.close')}
                  title={t('panel.close')}
                />
              }
            >
              <X aria-hidden="true" />
            </DialogPrimitive.Close>
          </header>

          <ViewerStage
            item={item}
            state={state}
            label={itemLabel}
            startAt={resumeAt.get(item.id) ?? 0}
            onRetry={() => files.retry(item)}
            onPhotoBroken={(src) => files.photoBroken(item, src)}
            onVideoFailed={(src, at) => {
              setResumeAt((times) => new Map(times).set(item.id, at));
              files.videoFailed(item, src);
            }}
            onVideoOpened={() => {
              setResumeAt((times) => {
                if (!times.has(item.id)) {
                  return times;
                }
                const next = new Map(times);
                next.delete(item.id);
                return next;
              });
              files.videoPlayed(item);
            }}
          />

          <footer className={`flex flex-col gap-1 border-t px-2 py-2 sm:px-4 ${BAR}`}>
            <div className="flex items-center justify-between gap-2">
              {count > 1 ? (
                <NavButton
                  label={t('panel.media.viewer.previous')}
                  isAtEnd={index === 0}
                  onPress={() => go(index - 1)}
                >
                  <ChevronLeft aria-hidden="true" />
                  <span className="hidden sm:inline">{t('panel.media.viewer.previous')}</span>
                </NavButton>
              ) : (
                <span />
              )}
              <p className="text-center text-xs text-muted-foreground">
                <time dateTime={item.createdAt}>
                  {t('panel.media.viewer.added', {
                    date: formatDateTime(item.createdAt, language),
                  })}
                </time>
                {duration === null ? null : ` · ${duration}`}
              </p>
              {count > 1 ? (
                <NavButton
                  label={t('panel.media.viewer.next')}
                  isAtEnd={index === count - 1}
                  onPress={() => go(index + 1)}
                >
                  <span className="hidden sm:inline">{t('panel.media.viewer.next')}</span>
                  <ChevronRight aria-hidden="true" />
                </NavButton>
              ) : (
                <span />
              )}
            </div>
            {shownDownload === null || shownDownload.status === 'pending' ? null : (
              <p role="alert" className="text-center text-xs text-destructive">
                {shownDownload.status === 'missing'
                  ? t('panel.media.viewer.deleted')
                  : t('panel.media.viewer.downloadFailed')}
              </p>
            )}
          </footer>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface NavButtonProps {
  label: string;
  /** No file lies that way: the button says so and does nothing. */
  isAtEnd: boolean;
  onPress: () => void;
  children: ReactNode;
}

/**
 * «Назад» or «Вперёд». At the end of the set it is marked unavailable rather
 * than disabled: a disabled button drops the focus it holds onto the page, and
 * the manager who walked to the last photo with it would be left nowhere.
 */
function NavButton({ label, isAtEnd, onPress, children }: NavButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={`${BAR_BUTTON} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
      aria-label={label}
      title={label}
      aria-disabled={isAtEnd || undefined}
      onClick={isAtEnd ? undefined : onPress}
    >
      {children}
    </Button>
  );
}

interface ViewerStageProps {
  item: ViewerItem;
  state: FileState;
  label: string;
  startAt: number;
  onRetry: () => void;
  onPhotoBroken: (src: string) => void;
  onVideoFailed: (src: string, at: number) => void;
  onVideoOpened: () => void;
}

/** The file on screen, or a word on where it stands: on its way, gone, or not to be had. */
function ViewerStage({
  item,
  state,
  label,
  startAt,
  onRetry,
  onPhotoBroken,
  onVideoFailed,
  onVideoOpened,
}: ViewerStageProps) {
  const { t } = useTranslation();

  if (state.status === 'ready') {
    return item.kind === 'video' ? (
      <VideoStage
        key={item.id}
        src={state.src}
        label={label}
        startAt={startAt}
        onFailed={onVideoFailed}
        onOpened={onVideoOpened}
      />
    ) : (
      <PhotoStage
        key={item.id}
        src={state.src}
        alt={label}
        onBroken={() => onPhotoBroken(state.src)}
      />
    );
  }

  return (
    <div
      data-viewer-backdrop=""
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-white"
    >
      {state.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2">
          <LoaderCircle aria-hidden="true" className="size-5 motion-safe:animate-spin" />
          {t('panel.media.viewer.loading')}
        </p>
      ) : state.status === 'deleted' ? (
        <p role="status">{t('panel.media.viewer.deleted')}</p>
      ) : (
        <div role="alert" className="flex flex-col items-center gap-3">
          <p>{t('panel.media.viewer.failed')}</p>
          <Button type="button" variant="secondary" className={BAR_BUTTON} onClick={onRetry}>
            {t('panel.media.viewer.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}
