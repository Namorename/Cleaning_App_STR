import { fireEvent, render, screen } from '@testing-library/react-native';

import type { MediaItemView } from '@/features/media/schema';

import { StepMedia } from '../step-media';

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

beforeEach(() => {
  jest.clearAllMocks();
});

test('asks for the minimum and offers the camera', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[]}
      limits={{ min: 2, max: 4 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByText('Снимите камерой не меньше 2 фото')).toBeTruthy();
  expect(screen.getByText('Пока ничего не снято')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Снять фото' }));

  expect(handlers.onCapture).toHaveBeenCalled();
});

test('says where each photo stands and counts them', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[
        item(),
        item({ id: 'm2', status: 'uploading' }),
        item({ id: 'm3', status: 'failed', uri: null }),
      ]}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByLabelText('Фото 1. Загружено')).toBeTruthy();
  expect(screen.getByLabelText('Фото 2. Загружается…')).toBeTruthy();
  expect(screen.getByLabelText('Фото 3. Не загрузилось')).toBeTruthy();
  expect(screen.getByText('Снято 3 из 4')).toBeTruthy();

  // Only the stranded one can be retried; every one can be taken back.
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(handlers.onRetry).toHaveBeenCalledWith('m3');

  await fireEvent.press(screen.getAllByRole('button', { name: 'Удалить' })[1]);
  expect(handlers.onRemove).toHaveBeenCalledWith('m2');
});

test('closes the camera once the step is full', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[item(), item({ id: 'm2' })]}
      limits={{ min: 1, max: 2 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByRole('button', { name: 'Снять фото' })).toBeDisabled();
});

test('a video step records one video and shows its length', async () => {
  await render(
    <StepMedia
      kind="video"
      items={[item({ kind: 'video', uri: null, durationSec: 20.5 })]}
      limits={{ min: 1, max: 10 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByText('Видео · 20.5 с')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Записать видео' })).toBeDisabled();
});

test('offers nothing to change once the step is closed', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[item()]}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled
      {...handlers}
    />,
  );

  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByLabelText('Фото 1. Загружено')).toBeTruthy();
});

// The gallery is the company's decision, not the phone's: a build that
// showed the button by default would let through the file the setting exists
// to keep out.
test('offers the camera alone until the company allows the gallery', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[]}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByRole('button', { name: 'Снять фото' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Выбрать фото из галереи' })).toBeNull();
});

test('and offers both once it has', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[]}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
      canPickFromGallery
    />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать фото из галереи' }));

  expect(handlers.onPickFromGallery).toHaveBeenCalled();
  expect(handlers.onCapture).not.toHaveBeenCalled();
});

test('a video step offers the gallery in its own words', async () => {
  await render(
    <StepMedia
      kind="video"
      items={[]}
      limits={{ min: 1, max: 1 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
      canPickFromGallery
    />,
  );

  expect(screen.getByRole('button', { name: 'Выбрать видео из галереи' })).toBeTruthy();
});
