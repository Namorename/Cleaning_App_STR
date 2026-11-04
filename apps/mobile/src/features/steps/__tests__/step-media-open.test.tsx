import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { PhotoViewerProps } from '@/features/media/photo-viewer';
import type { MediaItemView } from '@/features/media/schema';

import { StepMedia } from '../step-media';

/**
 * A step's photos and its video open on the whole screen (2026-11-03): the
 * tile is a button named «Открыть фото N из M» — «Открыть видео» for the
 * step's video — with its state read after the name, and the retry and the
 * removal stay buttons of their own under it.
 */

/** What each picture would say if it failed, by the uri it was drawn from. */
const mockOnError = new Map<string, (event: { error: string }) => void>();

jest.mock('expo-image', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: ({
      source,
      onError,
    }: {
      source: { uri: string };
      onError?: (event: { error: string }) => void;
    }) => {
      if (onError !== undefined) {
        mockOnError.set(source.uri, onError);
      }
      return createElement(View);
    },
  };
});

/** The viewer as the step opens it: what it was handed (photo-viewer.test.tsx tests the viewer). */
const mockViewer: { props: PhotoViewerProps | null } = { props: null };

jest.mock('@/features/media/photo-viewer-host', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PhotoViewerHost: (props: PhotoViewerProps) => {
      mockViewer.props = props;
      return createElement(View, { testID: 'viewer' });
    },
  };
});

function item(overrides: Partial<MediaItemView> = {}): MediaItemView {
  return {
    id: 'm1',
    kind: 'photo',
    uri: 'file:///kept/m1.jpg',
    status: 'uploaded',
    durationSec: null,
    ...overrides,
  };
}

const handlers = {
  canPickFromGallery: false,
  onCapture: jest.fn(),
  onPickFromGallery: jest.fn(),
  onRemove: jest.fn(),
  onRetry: jest.fn(),
};

function renderStep(kind: 'photo' | 'video', items: MediaItemView[], disabled = false) {
  return render(
    <StepMedia
      kind={kind}
      items={items}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={90}
      isCapturing={false}
      disabled={disabled}
      {...handlers}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockViewer.props = null;
});

test('a tap opens the viewer on that photo, with the step’s others to turn to', async () => {
  await renderStep('photo', [
    item(),
    item({ id: 'm2', status: 'failed', uri: null }),
    item({ id: 'm3', uri: 'https://x.example/m3.jpg' }),
  ]);

  await fireEvent.press(screen.getByRole('button', { name: 'Открыть фото 3 из 3' }));

  expect(screen.getByTestId('viewer')).toBeTruthy();
  expect(mockViewer.props).toEqual(
    expect.objectContaining({
      openId: 'm3',
      total: 3,
      items: [
        { id: 'm1', kind: 'photo', uri: 'file:///kept/m1.jpg', number: 1 },
        { id: 'm3', kind: 'photo', uri: 'https://x.example/m3.jpg', number: 3 },
      ],
    }),
  );

  await act(async () => mockViewer.props?.onClose());
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('the retry and the removal stay buttons of their own, and still work', async () => {
  await renderStep('photo', [item({ status: 'failed', failure: { key: 'interrupted' } })]);

  await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку. Фото 1' }));
  expect(handlers.onRetry).toHaveBeenCalledWith('m1');
  expect(screen.queryByTestId('viewer')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить. Фото 1' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));
  expect(handlers.onRemove).toHaveBeenCalledWith('m1');
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('the step’s video opens too, and says so on its tile', async () => {
  await renderStep('video', [
    item({ id: 'v1', kind: 'video', uri: 'file:///kept/v1.mp4', durationSec: 12 }),
  ]);

  const tile = screen.getByRole('button', { name: 'Открыть видео' });
  expect(tile.props.accessibilityValue).toEqual({ text: 'Загружено' });
  expect(screen.getByText('Смотреть')).toBeTruthy();

  await fireEvent.press(tile);

  expect(mockViewer.props).toEqual(
    expect.objectContaining({
      openId: 'v1',
      items: [{ id: 'v1', kind: 'video', uri: 'file:///kept/v1.mp4', number: 1 }],
    }),
  );
});

// A finished cleaning's video lives on the server only: the phone let its
// copy go once the video was in. It opens from its signed link all the same
// (owner, 2026-11-04), and a closed step offers no removal beside it.
test('a finished step’s video kept on the server only opens from its signed link', async () => {
  const signed = 'https://example.supabase.co/storage/v1/object/sign/task-media/v1.mp4?token=t';
  await renderStep(
    'video',
    [item({ id: 'v1', kind: 'video', uri: signed, durationSec: 12 })],
    true,
  );

  expect(screen.getByText('Смотреть')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Удалить/ })).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Открыть видео' }));

  expect(mockViewer.props).toEqual(
    expect.objectContaining({
      openId: 'v1',
      items: [{ id: 'v1', kind: 'video', uri: signed, number: 1 }],
    }),
  );
});

test('a video with nothing to play from yet does not offer to open', async () => {
  await renderStep('video', [item({ id: 'v1', kind: 'video', uri: null, durationSec: 12 })]);

  expect(screen.queryByRole('button', { name: 'Открыть видео' })).toBeNull();
  expect(screen.queryByText('Смотреть')).toBeNull();
});

test('a thumbnail that will not draw is reported without its link', async () => {
  const link = 'https://project.supabase.co/storage/v1/object/sign/task-media/m1.jpg?token=x';
  await renderStep('photo', [item({ uri: link })]);

  await act(async () =>
    mockOnError.get(link)?.({ error: `Download failed, response status code 400 ${link}` }),
  );

  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'Media not shown',
    expect.objectContaining({
      tags: { kind: 'photo', surface: 'step', source: 'remote', reason: 'http-400' },
      extra: { mediaId: 'm1' },
    }),
  );
  expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain('token');
});
