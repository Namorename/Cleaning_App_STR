import 'react-native-gesture-handler/jestSetup';

import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { keptItems, PhotoViewer } from '../photo-viewer';
import { PhotoViewerHost } from '../photo-viewer-host';
import type { ViewerItem } from '../viewer-items';

/**
 * The phone's viewer (2026-11-03): until now no photo opened bigger than its
 * tile, while the panel opened each one in the browser. It opens on the photo
 * tapped, turns through the row's others by a swipe or by its arrows, brings
 * a photo closer by a double tap, and closes by its button or the system's
 * back. Moves are instant here: the phone asks for less motion, so a value is
 * where it goes the moment it is set.
 */

// The libraries' own stand-ins: under Jest neither has its native half. A
// value set is where it goes at once, and a hop back to React runs as a
// microtask.
jest.mock('react-native-worklets', () => jest.requireActual('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => jest.requireActual('react-native-reanimated/mock'));

interface MockImageProps {
  testID?: string;
  source: { uri: string };
  onLoad?: (event: { source: { width: number; height: number } }) => void;
  onError?: (event: { error: string }) => void;
}

/** Every picture drawn, with what it was given. */
const mockImages: MockImageProps[] = [];

jest.mock('expo-image', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: (props: MockImageProps) => {
      mockImages.push(props);
      return createElement(View, { testID: props.testID });
    },
  };
});

type StatusListener = (payload: { status: string; error?: { message: string } }) => void;

const mockVideo: { source: unknown; props: Record<string, unknown>; listeners: StatusListener[] } =
  { source: null, props: {}, listeners: [] };

jest.mock('expo-video', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const player = {
    loop: true,
    addListener: (_event: string, listener: StatusListener) => {
      mockVideo.listeners.push(listener);
      return { remove: () => undefined };
    },
  };
  return {
    useVideoPlayer: (source: unknown, setup?: (created: typeof player) => void) => {
      mockVideo.source = source;
      setup?.(player);
      return player;
    },
    VideoView: (props: Record<string, unknown>) => {
      mockVideo.props = props;
      return createElement(View, { testID: 'viewer-video' });
    },
  };
});

const photos: ViewerItem[] = [
  { id: 'p1', kind: 'photo', uri: 'file:///kept/p1.jpg', number: 1 },
  { id: 'p2', kind: 'photo', uri: 'file:///kept/p2.jpg', number: 2 },
  { id: 'p3', kind: 'photo', uri: 'file:///kept/p3.jpg', number: 3 },
];

/** A finger across the screen, right to left by default: the next photo. */
function swipe(itemId: string, translationX = -300) {
  fireGestureHandler(getByGestureTestId(`viewer-pan-${itemId}`), [
    { state: State.BEGAN, translationX: 0, velocityX: 0 },
    { state: State.ACTIVE, translationX: 0, velocityX: 0 },
    { state: State.ACTIVE, translationX: translationX / 2, velocityX: 0 },
    { state: State.END, translationX, velocityX: 0 },
  ]);
}

function doubleTap(itemId: string) {
  fireGestureHandler(getByGestureTestId(`viewer-double-tap-${itemId}`), [
    { state: State.BEGAN, x: 375, y: 667 },
    { state: State.ACTIVE, x: 375, y: 667 },
    { state: State.END, x: 375, y: 667 },
  ]);
}

async function renderViewer(items: readonly ViewerItem[], openId: string, total = items.length) {
  const onClose = jest.fn();
  await render(<PhotoViewer items={items} total={total} openId={openId} onClose={onClose} />);
  // The phone's answer about motion comes after the first frame.
  await waitFor(() => expect(screen.getByTestId('photo-viewer').props.animationType).toBe('none'));
  /** The row redrawn by its owner with other tiles, as the screen would. */
  const redraw = async (next: readonly ViewerItem[], nextTotal = total) => {
    await screen.rerender(
      <PhotoViewer items={next} total={nextTotal} openId={openId} onClose={onClose} />,
    );
  };
  return { onClose, redraw };
}

/** The window under Jest is 750 points wide. */
const WIDTH = 750;

/** Where the row of pages stands: −index × width at rest (the first page's −0 read as 0). */
function rowOffset(): number | undefined {
  const style = StyleSheet.flatten(screen.getByTestId('viewer-row').props.style) as ViewStyle;
  const move = (style.transform as { translateX?: number }[] | undefined)?.find(
    (step) => step.translateX !== undefined,
  );
  return move?.translateX === undefined ? undefined : move.translateX + 0;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockImages.length = 0;
  mockVideo.listeners = [];
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

test('opens on the photo tapped, numbered as the row numbers it', async () => {
  await renderViewer(photos, 'p2', 5);

  expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 5');
  expect(screen.getByRole('image', { name: 'Фото 2 из 5' })).toBeTruthy();
});

// The tiles open it through the host, which loads the module on the first tap.
test('the host loads the viewer and opens it', async () => {
  await render(<PhotoViewerHost items={photos} total={3} openId="p3" onClose={jest.fn()} />);

  expect(screen.getByTestId('photo-viewer')).toBeTruthy();
  expect(screen.getByRole('header')).toHaveTextContent('Фото 3 из 3');
});

test('the photo is drawn from the tile’s own source, as the file it is', async () => {
  await renderViewer(
    [{ id: 'p1', kind: 'photo', uri: 'https://x.example/p1.jpg', number: 1 }],
    'p1',
  );

  expect(mockImages.map((image) => image.source.uri)).toContain('https://x.example/p1.jpg');
});

test('closes by its button and by the system’s back', async () => {
  const { onClose } = await renderViewer(photos, 'p1');

  await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));
  expect(onClose).toHaveBeenCalledTimes(1);

  await fireEvent(screen.getByTestId('photo-viewer'), 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(2);
});

test('the arrows turn the page, and stop at either end', async () => {
  await renderViewer(photos, 'p1');

  expect(screen.getByRole('button', { name: 'Предыдущее фото' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Следующее фото' }));
  expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3');
  await fireEvent.press(screen.getByRole('button', { name: 'Следующее фото' }));
  expect(screen.getByRole('header')).toHaveTextContent('Фото 3 из 3');
  expect(screen.getByRole('button', { name: 'Следующее фото' })).toBeDisabled();

  await fireEvent.press(screen.getByRole('button', { name: 'Предыдущее фото' }));
  expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3');
});

test('a swipe turns to the next photo and back; past the last it stays', async () => {
  await renderViewer(photos, 'p2');

  await act(async () => swipe('p2'));
  await waitFor(() => expect(screen.getByRole('header')).toHaveTextContent('Фото 3 из 3'));

  await act(async () => swipe('p3'));
  expect(screen.getByRole('header')).toHaveTextContent('Фото 3 из 3');

  await act(async () => swipe('p3', 300));
  await waitFor(() => expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3'));
});

test('a short drag springs back to the same photo', async () => {
  await renderViewer(photos, 'p1');

  await act(async () => swipe('p1', -60));

  expect(screen.getByRole('header')).toHaveTextContent('Фото 1 из 3');
});

// Brought closer, the finger moves the photo instead of turning the page;
// a second double tap takes it back, and the swipe turns the page again.
test('a double tap brings the photo closer, and a swipe then moves it rather than turning', async () => {
  await renderViewer(photos, 'p1');

  await act(async () => doubleTap('p1'));
  await act(async () => swipe('p1'));
  expect(screen.getByRole('header')).toHaveTextContent('Фото 1 из 3');

  await act(async () => doubleTap('p1'));
  await act(async () => swipe('p1'));
  await waitFor(() => expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3'));
});

test('two fingers bring it closer as well', async () => {
  await renderViewer(photos, 'p1');

  await act(async () =>
    fireGestureHandler(getByGestureTestId('viewer-pinch-p1'), [
      { state: State.BEGAN, scale: 1, focalX: 375, focalY: 667 },
      { state: State.ACTIVE, scale: 1, focalX: 375, focalY: 667 },
      { state: State.ACTIVE, scale: 2, focalX: 375, focalY: 667 },
      { state: State.END, scale: 2, focalX: 375, focalY: 667 },
    ]),
  );
  await act(async () => swipe('p1'));

  expect(screen.getByRole('header')).toHaveTextContent('Фото 1 из 3');
});

test('a pinch let go below its own size springs back, and the swipe turns again', async () => {
  await renderViewer(photos, 'p1');

  await act(async () =>
    fireGestureHandler(getByGestureTestId('viewer-pinch-p1'), [
      { state: State.BEGAN, scale: 1, focalX: 375, focalY: 667 },
      { state: State.ACTIVE, scale: 1, focalX: 375, focalY: 667 },
      { state: State.ACTIVE, scale: 0.5, focalX: 375, focalY: 667 },
      { state: State.END, scale: 0.5, focalX: 375, focalY: 667 },
    ]),
  );
  await act(async () => swipe('p1'));

  await waitFor(() => expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3'));
});

test('draws the photo on screen and its neighbours only', async () => {
  const four = [
    ...photos,
    { id: 'p4', kind: 'photo' as const, uri: 'file:///kept/p4.jpg', number: 4 },
  ];
  await renderViewer(four, 'p1');

  expect(screen.getAllByTestId('viewer-photo', { includeHiddenElements: true })).toHaveLength(2);
});

test('only the photo on screen is there for the reader', async () => {
  await renderViewer(photos, 'p1');

  expect(screen.getByRole('image', { name: 'Фото 1 из 3' })).toBeTruthy();
  expect(screen.queryByRole('image', { name: 'Фото 2 из 3' })).toBeNull();
});

test('a single photo has no arrows', async () => {
  await renderViewer([photos[0] as ViewerItem], 'p1');

  expect(screen.queryByRole('button', { name: 'Следующее фото' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Предыдущее фото' })).toBeNull();
});

test('a photo that will not show says so, and the report carries no link', async () => {
  const link =
    'https://project.supabase.co/storage/v1/object/sign/task-media/a/p1.jpg?token=secret';
  await renderViewer([{ id: 'p1', kind: 'photo', uri: link, number: 1 }], 'p1');

  const image = mockImages.find((drawn) => drawn.source.uri === link);
  await act(async () => image?.onError?.({ error: `Failed to load ${link}, status code: 404` }));

  expect(screen.getByText('Не удалось показать фото')).toBeTruthy();
  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'Media not shown',
    expect.objectContaining({
      tags: { kind: 'photo', surface: 'viewer', source: 'remote', reason: 'http-404' },
      extra: { mediaId: 'p1' },
    }),
  );
  const sent = JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls);
  expect(sent).not.toContain('token');
  expect(sent).not.toContain('supabase');
});

describe('the row under the viewer', () => {
  test('the row stands where the page is: after the arrows, after a swipe', async () => {
    await renderViewer(photos, 'p1');
    expect(rowOffset()).toBe(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Следующее фото' }));
    expect(rowOffset()).toBe(-WIDTH);

    await act(async () => swipe('p2'));
    await waitFor(() => expect(screen.getByRole('header')).toHaveTextContent('Фото 3 из 3'));
    expect(rowOffset()).toBe(-2 * WIDTH);
  });

  test('a screen of another width moves the row with it', async () => {
    await renderViewer(photos, 'p2');

    await fireEvent(screen.getByTestId('viewer-screen'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } },
    });

    expect(rowOffset()).toBe(-400);
  });

  // Found in review: a link fetched again is null for a moment, which took
  // the photo out of the row and closed the viewer.
  test('a link fetched again under the viewer keeps the photo open, from its old link', async () => {
    const remote = photos.map((photo) => ({ ...photo, uri: `https://x.example/${photo.id}.jpg` }));
    const { onClose, redraw } = await renderViewer(remote, 'p2');

    await redraw([]);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3');
    expect(mockImages.at(-1)?.source.uri).toMatch(/^https:\/\/x\.example\//);
  });

  test('a file that leaves the row keeps its page, and the page under the thumb stays', async () => {
    const { redraw } = await renderViewer(photos, 'p3');

    await redraw(photos.slice(0, 2), 2);

    expect(screen.getByRole('image', { name: 'Фото 3 из 3' })).toBeTruthy();
    expect(rowOffset()).toBe(-2 * WIDTH);
  });

  test('a renewed link replaces the old one', async () => {
    const { redraw } = await renderViewer(photos, 'p1');

    await redraw([
      { ...(photos[0] as ViewerItem), uri: 'https://x.example/new-p1.jpg' },
      ...photos.slice(1),
    ]);

    expect(mockImages.map((image) => image.source.uri)).toContain('https://x.example/new-p1.jpg');
  });

  test('keptItems brings fresh links in by id and leaves the rest as they were', () => {
    const fresh = [{ ...(photos[1] as ViewerItem), uri: 'https://x.example/p2.jpg' }];

    const kept = keptItems(photos, fresh);

    expect(kept.map((item) => item.uri)).toEqual([
      'file:///kept/p1.jpg',
      'https://x.example/p2.jpg',
      'file:///kept/p3.jpg',
    ]);
    expect(keptItems(photos, photos)).toBe(photos);
  });
});

test('a drag cut short by a second finger stays on the photo', async () => {
  await renderViewer(photos, 'p1');

  await act(async () =>
    fireGestureHandler(getByGestureTestId('viewer-pan-p1'), [
      { state: State.BEGAN, translationX: 0, velocityX: 0 },
      { state: State.ACTIVE, translationX: 0, velocityX: 0 },
      { state: State.ACTIVE, translationX: -400, velocityX: 0 },
      { state: State.CANCELLED, translationX: -400, velocityX: 0 },
    ]),
  );

  expect(screen.getByRole('header')).toHaveTextContent('Фото 1 из 3');
  expect(rowOffset()).toBe(0);
});

test('the photo on screen is decoded for twice the screen, its neighbours for the screen', async () => {
  await renderViewer(photos, 'p1');

  const sizeOf = (id: string) =>
    StyleSheet.flatten(
      screen.getByTestId(`viewer-canvas-${id}`, { includeHiddenElements: true }).props.style,
    ) as ViewStyle;
  expect(sizeOf('p1').width).toBe(2 * WIDTH);
  expect(sizeOf('p2').width).toBe(WIDTH);
});

test('the title is a live region, so a page turned is read', async () => {
  await renderViewer(photos, 'p1');

  expect(screen.getByRole('header').props.accessibilityLiveRegion).toBe('polite');
});

// Found in review: a page that would not show had no gestures, and a link
// renewed after the failure was never tried.
test('a photo that will not show is still swiped past, and a renewed link is tried again', async () => {
  const { redraw } = await renderViewer(photos, 'p1');
  const first = mockImages.find((drawn) => drawn.source.uri === 'file:///kept/p1.jpg');
  await act(async () => first?.onError?.({ error: 'Failed to decode image' }));
  expect(screen.getByText('Не удалось показать фото')).toBeTruthy();

  await redraw([
    { ...(photos[0] as ViewerItem), uri: 'file:///kept/p1-again.jpg' },
    ...photos.slice(1),
  ]);
  expect(screen.queryByText('Не удалось показать фото')).toBeNull();

  const again = mockImages.find((drawn) => drawn.source.uri === 'file:///kept/p1-again.jpg');
  await act(async () => again?.onError?.({ error: 'Failed to decode image' }));
  await act(async () => swipe('p1'));
  await waitFor(() => expect(screen.getByRole('header')).toHaveTextContent('Фото 2 из 3'));
});

describe('a video', () => {
  const video: ViewerItem = { id: 'v1', kind: 'video', uri: 'file:///kept/v1.mp4', number: 1 };

  test('plays in the phone’s own player with its controls, named for the reader', async () => {
    await renderViewer([video], 'v1');

    expect(screen.getByRole('header')).toHaveTextContent('Видео');
    expect(mockVideo.source).toBe('file:///kept/v1.mp4');
    expect(mockVideo.props).toEqual(
      expect.objectContaining({ nativeControls: true, accessibilityLabel: 'Просмотр записи' }),
    );
    expect(screen.queryByRole('button', { name: 'Следующее фото' })).toBeNull();
  });

  test('one that will not play says so and is reported without its link', async () => {
    await renderViewer([video], 'v1');

    await act(async () => {
      for (const listener of mockVideo.listeners) {
        listener({ status: 'error', error: { message: 'Cannot open file:///kept/v1.mp4' } });
      }
    });

    expect(screen.getByText('Не удалось показать видео')).toBeTruthy();
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Media not shown',
      expect.objectContaining({
        tags: { kind: 'video', surface: 'viewer', source: 'local', reason: 'other' },
      }),
    );
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain('v1.mp4');
  });
});
