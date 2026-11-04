import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { PhotoViewerProps } from '@/features/media/photo-viewer';

import type { MessageTile } from '../media-tiles';
import { MessageMedia } from '../message-media';

/**
 * The photos of a message open on the whole screen (2026-11-03), and the
 * viewer turns through that message's others. A photo still on its way to
 * this phone has nothing to open; a stranded one of her own keeps its retry
 * and its removal as buttons of their own.
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

/** The viewer as the bubble opens it: what it was handed (photo-viewer.test.tsx tests the viewer). */
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

const tiles: MessageTile[] = [
  { id: 'c1', uri: 'https://x.example/c1.jpg', status: 'uploaded', canRemove: true },
  { id: 'c2', uri: null, status: 'awaited', canRemove: true },
  { id: 'c3', uri: 'file:///kept/c3.jpg', status: 'failed', canRemove: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockViewer.props = null;
});

test('each photo with a picture is a button that opens it; one on its way is not', async () => {
  await render(<MessageMedia tiles={tiles} />);

  expect(
    screen.getByRole('button', { name: 'Открыть фото 1 из 3' }).props.accessibilityValue,
  ).toEqual({ text: 'Загружено' });
  expect(screen.getByLabelText('Фото 2. Фото в пути')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Открыть фото 2 из 3' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Открыть фото 3 из 3' }).props.accessibilityValue,
  ).toEqual({ text: 'Не загрузилось' });
});

test('a tap opens the viewer on that photo, with the message’s others to turn to', async () => {
  await render(<MessageMedia tiles={tiles} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Открыть фото 3 из 3' }));

  expect(mockViewer.props).toEqual(
    expect.objectContaining({
      openId: 'c3',
      total: 3,
      items: [
        { id: 'c1', kind: 'photo', uri: 'https://x.example/c1.jpg', number: 1 },
        { id: 'c3', kind: 'photo', uri: 'file:///kept/c3.jpg', number: 3 },
      ],
    }),
  );

  await act(async () => mockViewer.props?.onClose());
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('her stranded photo keeps its retry and removal, apart from the photo', async () => {
  const onRetry = jest.fn();
  const onRemove = jest.fn();
  await render(<MessageMedia tiles={tiles} onRetry={onRetry} onRemove={onRemove} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));

  expect(onRetry).toHaveBeenCalledWith('c3');
  expect(onRemove).toHaveBeenCalledWith('c3');
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('a thumbnail that will not draw is reported without its link', async () => {
  await render(<MessageMedia tiles={tiles} />);

  await act(async () =>
    mockOnError.get('https://x.example/c1.jpg')?.({
      error: 'Failed to load https://x.example/c1.jpg, status code: 403',
    }),
  );

  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'Media not shown',
    expect.objectContaining({
      tags: { kind: 'photo', surface: 'chat', source: 'remote', reason: 'http-403' },
      extra: { mediaId: 'c1' },
    }),
  );
  expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain(
    'x.example',
  );
});
