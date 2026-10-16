import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { formatVideoDuration, groupByStep, stepMediaListSchema } from '../schema';
import { VideoTile } from '../video-tile';

const URL = 'https://project.supabase.co/storage/v1/object/sign/task-media/a.mp4?token=t';

/** `MediaError` codes, as a browser sets them on the element before `error` fires. */
const MEDIA_ERR = { aborted: 1, network: 2, decode: 3, unsupported: 4 } as const;

/** The player fails the way a browser's does: jsdom leaves `video.error` null. */
function failWith(code: number, label = 'Видео') {
  const video = screen.getByLabelText(label);
  Object.defineProperty(video, 'error', { configurable: true, value: { code } });
  fireEvent.error(video);
}

/** A parent's refetch that answers only when the test says so. */
function heldRefetch() {
  let release: () => void = () => undefined;
  const onExpired = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return { onExpired, settle: () => act(async () => release()) };
}

describe('formatVideoDuration', () => {
  test('reads seconds as minutes and seconds', () => {
    expect(formatVideoDuration(65)).toBe('1:05');
    expect(formatVideoDuration(120)).toBe('2:00');
    expect(formatVideoDuration(9)).toBe('0:09');
  });

  test('rounds the phone timer to a whole second', () => {
    expect(formatVideoDuration(64.6)).toBe('1:05');
  });

  test('says nothing when the length is not known', () => {
    expect(formatVideoDuration(null)).toBeNull();
    expect(formatVideoDuration(-1)).toBeNull();
    expect(formatVideoDuration(Number.NaN)).toBeNull();
  });
});

describe('the media of a step, as the server hands it over', () => {
  const row = {
    id: 'm1',
    step_id: 's1',
    storage_path: 'h/t/s1/m1.mp4',
    created_at: '2026-10-09T08:00:00+00:00',
    source: 'camera',
    kind: 'video',
    duration_sec: 65,
  };

  test('keeps the kind and the length', () => {
    const [media] = stepMediaListSchema.parse([row]);

    expect(media.kind).toBe('video');
    expect(media.duration_sec).toBe(65);
  });

  // The column is an enum of two today; a third value must not blank the steps.
  test('reads a kind it does not know as a photo rather than failing the list', () => {
    const [media] = stepMediaListSchema.parse([{ ...row, kind: 'document', duration_sec: 'x' }]);

    expect(media.kind).toBe('photo');
    expect(media.duration_sec).toBeNull();
  });

  test('groups by step, in the order it came, and leaves out what has no step', () => {
    const groups = groupByStep([
      { id: 'a', step_id: 's1' },
      { id: 'b', step_id: null },
      { id: 'c', step_id: 's2' },
      { id: 'd', step_id: 's1' },
    ]);

    expect(groups).toEqual({
      s1: [
        { id: 'a', step_id: 's1' },
        { id: 'd', step_id: 's1' },
      ],
      s2: [{ id: 'c', step_id: 's2' }],
    });
  });
});

describe('VideoTile', () => {
  test('plays the signed link with the browser controls, loading only its metadata', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео: Видео после работы" />);

    const video = screen.getByLabelText('Видео: Видео после работы');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('src', URL);
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('preload', 'metadata');
    // iPhone Safari would otherwise take the manager full screen on play.
    expect(video).toHaveAttribute('playsinline');
  });

  test('says how long it is', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    expect(screen.getByText('Видео · 1:05')).toBeInTheDocument();
  });

  test('says only that it is a video when the length is not known', () => {
    render(<VideoTile url={URL} durationSec={null} label="Видео 1" />);

    expect(screen.getByText('Видео')).toBeInTheDocument();
  });

  test('opens larger in a new tab, as a photo does', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    const link = screen.getByRole('link', { name: 'Открыть видео в новой вкладке' });
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });

  // Design decision 5: every target other than the phone's main buttons is at least 48.
  test('the link that opens it is a 48 px target', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    const link = screen.getByRole('link', { name: 'Открыть видео в новой вкладке' });
    expect(link).toHaveClass('min-h-12', 'min-w-12');
  });

  // A phone films upright: a square that crops would cut off the top and the bottom.
  test('shows the whole frame, a portrait video included, in a player wide enough for its controls', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    const video = screen.getByLabelText('Видео');
    expect(video).toHaveClass('object-contain');
    expect(video).not.toHaveClass('object-cover');
    expect(video.closest('figure')).toHaveClass('w-64');
  });
});

describe('VideoTile — a link signed again', () => {
  const FRESH = 'https://project.supabase.co/storage/v1/object/sign/task-media/a.mp4?token=t2';
  const FRESHER = 'https://project.supabase.co/storage/v1/object/sign/task-media/a.mp4?token=t3';

  // The work queries sign every file again on each fetch; a focus refetch
  // after the stale time would otherwise reload the player and restart it at 0:00.
  test('keeps playing the link it started with when a refetch hands it a fresh one', () => {
    const { rerender } = render(<VideoTile url={URL} durationSec={65} label="Видео" />);

    rerender(<VideoTile url={FRESH} durationSec={65} label="Видео" />);

    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', URL);
  });

  // An hour on, the link it started with has expired: only then is the fresh one taken.
  test('takes the newest link when the one it plays fails', () => {
    const { rerender } = render(<VideoTile url={URL} durationSec={65} label="Видео" />);
    rerender(<VideoTile url={FRESH} durationSec={65} label="Видео" />);
    rerender(<VideoTile url={FRESHER} durationSec={65} label="Видео" />);

    fireEvent.error(screen.getByLabelText('Видео'));

    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', FRESHER);
  });
});

describe('VideoTile — a video that cannot be shown', () => {
  // An HEVC .mov from an iPhone does not play in Chrome: the element errors
  // with no newer link to try, and a black square with dead controls says nothing.
  test.each([MEDIA_ERR.decode, MEDIA_ERR.unsupported])(
    'error %i: says it is unavailable and still offers to open it in a new tab',
    (code) => {
      render(<VideoTile url={URL} durationSec={65} label="Видео" />);

      failWith(code);

      expect(document.querySelector('video')).toBeNull();
      expect(screen.getByText('Видео недоступно')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Открыть видео в новой вкладке' })).toHaveAttribute(
        'href',
        URL,
      );
    },
  );

  test('a link that failed after a fresh one was taken falls back the same way', () => {
    const fresh = `${URL}2`;
    const { rerender } = render(<VideoTile url={URL} durationSec={65} label="Видео" />);
    rerender(<VideoTile url={fresh} durationSec={65} label="Видео" />);

    failWith(MEDIA_ERR.unsupported);
    failWith(MEDIA_ERR.unsupported);

    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть видео в новой вкладке' })).toHaveAttribute(
      'href',
      fresh,
    );
  });

  test('a video storage would not sign says so, with nothing to open', () => {
    render(<VideoTile url={null} durationSec={30} label="Видео" />);

    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  // The swap from a player to a line of text is heard, and says whose video it was.
  test('the line that stands in for the player keeps the step’s name and is announced', () => {
    render(<VideoTile url={URL} durationSec={65} label="Видео: Видео после работы" />);

    failWith(MEDIA_ERR.unsupported, 'Видео: Видео после работы');

    expect(screen.getByRole('status', { name: 'Видео: Видео после работы' })).toHaveTextContent(
      'Видео недоступно',
    );
  });
});

describe('VideoTile — a failure it recovers from', () => {
  // A dropped connection or a stopped load is not a file that cannot be
  // played: the browser's own controls let the manager press play again.
  test.each([MEDIA_ERR.aborted, MEDIA_ERR.network])(
    'error %i keeps the player and its link',
    (code) => {
      render(<VideoTile url={URL} durationSec={65} label="Видео" />);

      failWith(code);

      expect(screen.getByLabelText('Видео')).toHaveAttribute('src', URL);
      expect(screen.queryByText('Видео недоступно')).toBeNull();
    },
  );

  test('a new link handed over after a failure is tried', () => {
    const fresh = `${URL}2`;
    const { rerender } = render(<VideoTile url={URL} durationSec={65} label="Видео" />);
    failWith(MEDIA_ERR.unsupported);
    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();

    rerender(<VideoTile url={fresh} durationSec={65} label="Видео" />);

    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', fresh);
    expect(screen.queryByText('Видео недоступно')).toBeNull();
  });

  test('a file signed only on a later fetch is played once it has a link', () => {
    const { rerender } = render(<VideoTile url={null} durationSec={65} label="Видео" />);
    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();

    rerender(<VideoTile url={URL} durationSec={65} label="Видео" />);

    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', URL);
  });
});

describe('VideoTile — a link that has expired', () => {
  const FRESH = `${URL}-fresh`;

  // A signed link lives an hour: the newest one the tile holds may be the
  // one that failed, and only the parent can sign the file again.
  test('asks for a fresh link before saying the video is unavailable, and plays it', async () => {
    const { onExpired, settle } = heldRefetch();
    const { rerender } = render(
      <VideoTile url={URL} durationSec={65} label="Видео" onExpired={onExpired} />,
    );

    failWith(MEDIA_ERR.unsupported);

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Видео недоступно')).toBeNull();

    rerender(<VideoTile url={FRESH} durationSec={65} label="Видео" onExpired={onExpired} />);
    await settle();

    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', FRESH);
    expect(screen.queryByText('Видео недоступно')).toBeNull();
  });

  test('says it is unavailable when the parent has no fresh link to give', async () => {
    const { onExpired, settle } = heldRefetch();
    render(<VideoTile url={URL} durationSec={65} label="Видео" onExpired={onExpired} />);

    failWith(MEDIA_ERR.unsupported);
    await settle();

    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();
  });

  // Every refetch signs anew: a file that cannot be played would otherwise
  // ask, fail on the fresh link, and ask again without end.
  test('asks once: a fresh link that fails too is unavailable without asking again', async () => {
    const { onExpired, settle } = heldRefetch();
    const { rerender } = render(
      <VideoTile url={URL} durationSec={65} label="Видео" onExpired={onExpired} />,
    );
    failWith(MEDIA_ERR.unsupported);
    rerender(<VideoTile url={FRESH} durationSec={65} label="Видео" onExpired={onExpired} />);
    await settle();

    failWith(MEDIA_ERR.unsupported);

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Видео недоступно')).toBeInTheDocument();
  });

  // A link that expires while the video stands paused fails on its next load
  // as a network error, not as a file that cannot be read.
  test('a network error asks for a fresh link too, and keeps the player meanwhile', async () => {
    const { onExpired, settle } = heldRefetch();
    const { rerender } = render(
      <VideoTile url={URL} durationSec={65} label="Видео" onExpired={onExpired} />,
    );

    failWith(MEDIA_ERR.network);
    await settle();

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', URL);

    rerender(<VideoTile url={FRESH} durationSec={65} label="Видео" onExpired={onExpired} />);

    expect(screen.getByLabelText('Видео')).toHaveAttribute('src', FRESH);
  });

  test('asks again once a fresh link has played', async () => {
    const { onExpired, settle } = heldRefetch();
    const { rerender } = render(
      <VideoTile url={URL} durationSec={65} label="Видео" onExpired={onExpired} />,
    );
    failWith(MEDIA_ERR.network);
    rerender(<VideoTile url={FRESH} durationSec={65} label="Видео" onExpired={onExpired} />);
    await settle();
    fireEvent.loadedMetadata(screen.getByLabelText('Видео'));

    failWith(MEDIA_ERR.network);

    await waitFor(() => expect(onExpired).toHaveBeenCalledTimes(2));
  });
});
