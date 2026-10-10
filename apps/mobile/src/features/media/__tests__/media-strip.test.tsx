import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/constants/theme';

import { mediaFileUri } from '../media-path';
import { MediaStrip, type StripItem } from '../media-strip';

/**
 * The photos of a report, side by side. Their actions were text 24 high, and
 * inside a tile the reader announced as one element, where a screen reader
 * could not reach them at all (docs/design/redesign-directions.html,
 * `pproblems`). Each is now a button of its own, at least 48 dp, named with
 * what it does and which photo it does it to.
 */

/** The uri each picture is drawn from, as the strip hands it over. */
const mockDrawn: string[] = [];

jest.mock('expo-image', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Image: ({ source }: { source: { uri: string } }) => {
      mockDrawn.push(source.uri);
      return createElement(View);
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

test('each photo is announced with its number and its state', async () => {
  await render(<MediaStrip items={items} maxCount={5} />);

  expect(screen.getByLabelText('Фото 1. Не загрузилось')).toBeTruthy();
  expect(screen.getByLabelText('Фото 2. Будет отправлено')).toBeTruthy();
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

  const photo = screen.getByLabelText('Фото 1. Не загрузилось');
  expect(within(photo).queryByRole('button')).toBeNull();
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
