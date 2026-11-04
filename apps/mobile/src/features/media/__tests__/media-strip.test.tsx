import * as Sentry from '@sentry/react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';

import { mediaFileUri } from '../media-path';
import { MediaStrip, type StripItem } from '../media-strip';
import type { PhotoViewerProps } from '../photo-viewer';

/**
 * The photos of a report, side by side. Their actions were text 24 high, and
 * inside a tile the reader announced as one element, where a screen reader
 * could not reach them at all (docs/design/redesign-directions.html,
 * `pproblems`). Each is now a button of its own, at least 48 dp, named with
 * what it does and which photo it does it to.
 */

/** The uri each picture is drawn from, as the strip hands it over. */
const mockDrawn: string[] = [];
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
      mockDrawn.push(source.uri);
      if (onError !== undefined) {
        mockOnError.set(source.uri, onError);
      }
      return createElement(View);
    },
  };
});

/** The viewer as the strip opens it: what it was handed (photo-viewer.test.tsx tests the viewer). */
const mockViewer: { props: PhotoViewerProps | null } = { props: null };

jest.mock('../photo-viewer-host', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    PhotoViewerHost: (props: PhotoViewerProps) => {
      mockViewer.props = props;
      return createElement(View, { testID: 'viewer' });
    },
  };
});

const items: StripItem[] = [
  { id: 'm1', uri: 'file:///one.jpg', status: 'failed' },
  { id: 'm2', uri: 'file:///two.jpg', status: 'local' },
];

function heightOf(name: string): number | undefined {
  const box = StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as ViewStyle;
  return box.minHeight as number | undefined;
}

// Since 2026-11-03 a photo opens on the whole screen: the tile is a button
// named with its number of the strip's, its state read after the name.
test('each photo is a button that opens it, with its number and its state', async () => {
  await render(<MediaStrip items={items} maxCount={5} />);

  const first = screen.getByRole('button', { name: 'Открыть фото 1 из 2' });
  expect(first.props.accessibilityValue).toEqual({ text: 'Не загрузилось' });
  const second = screen.getByRole('button', { name: 'Открыть фото 2 из 2' });
  expect(second.props.accessibilityValue).toEqual({ text: 'Будет отправлено' });
});

test('a tap opens the viewer on that photo, with the strip’s others to turn to', async () => {
  await render(<MediaStrip items={items} maxCount={5} onRemove={jest.fn()} />);
  expect(screen.queryByTestId('viewer')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: 'Открыть фото 2 из 2' }));

  expect(screen.getByTestId('viewer')).toBeTruthy();
  expect(mockViewer.props).toEqual(
    expect.objectContaining({
      openId: 'm2',
      total: 2,
      items: [
        { id: 'm1', kind: 'photo', uri: 'file:///one.jpg', number: 1 },
        { id: 'm2', kind: 'photo', uri: 'file:///two.jpg', number: 2 },
      ],
    }),
  );

  await act(async () => mockViewer.props?.onClose());
  expect(screen.queryByTestId('viewer')).toBeNull();
});

test('a photo with nothing to draw from yet is a picture, not a button', async () => {
  await render(<MediaStrip items={[{ id: 'm3', uri: null, status: 'uploading' }]} maxCount={5} />);

  expect(screen.getByLabelText('Фото 1. Загружается')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Открыть/ })).toBeNull();
});

test('a thumbnail that will not draw is reported without its path', async () => {
  await render(<MediaStrip items={items} maxCount={5} />);

  await act(async () =>
    mockOnError.get('file:///one.jpg')?.({ error: 'open failed: ENOENT file:///one.jpg' }),
  );

  expect(Sentry.captureMessage).toHaveBeenCalledWith(
    'Media not shown',
    expect.objectContaining({
      tags: { kind: 'photo', surface: 'strip', source: 'local', reason: 'no-file' },
      extra: { mediaId: 'm1' },
    }),
  );
  expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain('one.jpg');
});

test('removing names the photo, asks first, and hands back its id', async () => {
  const onRemove = jest.fn();
  await render(<MediaStrip items={items} maxCount={5} onRemove={onRemove} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить фото 2' }));
  expect(onRemove).not.toHaveBeenCalled();
  expect(screen.getByRole('header', { name: 'Удалить фото?' })).toBeTruthy();
  expect(screen.getByText('Фото 2')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Удалить' }));

  expect(onRemove).toHaveBeenCalledWith('m2');
});

test('«Отмена» keeps the photo', async () => {
  const onRemove = jest.fn();
  await render(<MediaStrip items={items} maxCount={5} onRemove={onRemove} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить фото 2' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));

  expect(onRemove).not.toHaveBeenCalled();
});

// A photo not sent yet — the chat's draft — goes without a question: nothing
// of it has left the phone, and taking it back is the way to send another.
test('a draft not sent yet goes at once where the screen says so', async () => {
  const onRemove = jest.fn();
  await render(
    <MediaStrip items={items} maxCount={5} onRemove={onRemove} isRemovalAsked={false} />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить фото 2' }));

  expect(onRemove).toHaveBeenCalledWith('m2');
  expect(screen.queryByRole('header', { name: 'Удалить фото?' })).toBeNull();
});

test('a retry names the photo, and is offered only where the upload failed', async () => {
  const onRetry = jest.fn();
  await render(<MediaStrip items={items} maxCount={5} onRetry={onRetry} />);

  await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку фото 1' }));

  expect(onRetry).toHaveBeenCalledWith('m1');
  expect(screen.queryByRole('button', { name: 'Повторить загрузку фото 2' })).toBeNull();
});

test('every action is a target of at least 48 dp', async () => {
  await render(<MediaStrip items={items} maxCount={5} onRemove={jest.fn()} onRetry={jest.fn()} />);

  for (const name of ['Повторить загрузку фото 1', 'Удалить фото 1', 'Удалить фото 2']) {
    expect(heightOf(name)).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  }
});

test('the actions sit beside the photo for the reader, not inside it', async () => {
  await render(<MediaStrip items={items} maxCount={5} onRemove={jest.fn()} onRetry={jest.fn()} />);

  const photo = screen.getByRole('button', { name: 'Открыть фото 1 из 2' });
  expect(within(photo).queryByRole('button', { name: 'Повторить загрузку фото 1' })).toBeNull();
  expect(within(photo).queryByRole('button', { name: 'Удалить фото 1' })).toBeNull();
});

test('the visible words stay short: the number is for the reader', async () => {
  await render(<MediaStrip items={items} maxCount={5} onRemove={jest.fn()} />);

  expect(screen.getAllByText('Удалить')).toHaveLength(2);
});

/**
 * A photo kept on the phone is remembered by its place in the documents
 * (iPhone risk 1); the picture is drawn from the documents of this run — and
 * a photo an older build remembered by the full path of another install is
 * drawn from there too, not left blank.
 */
describe('where a kept photo is drawn from', () => {
  beforeEach(() => {
    mockDrawn.length = 0;
  });

  /** What the pictures were given, in order, each once. */
  function drawnUris(): string[] {
    return [...new Set(mockDrawn)];
  }

  test('a photo remembered by its place, and one by an old full path', async () => {
    await render(
      <MediaStrip
        items={[
          { id: 'm1', uri: 'task-media/m1.jpg', status: 'local' },
          {
            id: 'm2',
            uri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/task-media/m2.jpg',
            status: 'local',
          },
        ]}
        maxCount={5}
      />,
    );

    expect(drawnUris()).toEqual([
      mediaFileUri('task-media/m1.jpg'),
      mediaFileUri('task-media/m2.jpg'),
    ]);
    expect(drawnUris()[0]).toMatch(/^file:\/\/.+\/task-media\/m1\.jpg$/);
  });

  test('a signed link is drawn as it is', async () => {
    const link = 'https://project.supabase.co/storage/v1/object/sign/task-media/a.jpg?token=t';
    await render(<MediaStrip items={[{ id: 'm1', uri: link, status: 'uploaded' }]} maxCount={5} />);

    expect(drawnUris()).toEqual([link]);
  });
});

test('a strip that is busy sending offers no actions', async () => {
  await render(
    <MediaStrip items={items} maxCount={5} onRemove={jest.fn()} onRetry={jest.fn()} disabled />,
  );

  expect(screen.queryByRole('button', { name: 'Удалить фото 1' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Повторить загрузку фото 1' })).toBeNull();
});
