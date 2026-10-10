import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { PickedVideo } from '@/features/media/capture';
import {
  RecordRoute,
  STEP_ID,
  TASK_ID,
  deferred,
  discardFile,
  keep,
  kept,
  mockAttach,
  mockLeaveGuard,
  mockParams,
  mockPermissions,
  mockPreview,
  mockVideo,
  pick,
  pressInAlert,
  router,
  setUpRecordRoute,
} from '@/testing/record-route';

/**
 * A video step's video chosen from the gallery, where the company allows the
 * gallery (night of 2026-10-10, block 6): the gallery opens instead of the
 * camera, the file is held to the step's length and the company's size
 * before anything is registered, then watched and sent like a recording —
 * declared as from the gallery.
 */

setUpRecordRoute();

const PICKED_URI = 'file:///cache/ImagePicker/clip.mp4';

function picked(overrides: Partial<PickedVideo> = {}): PickedVideo {
  return {
    uri: PICKED_URI,
    durationSec: 20,
    takenAt: '2026-10-10T08:00:00.000Z',
    byteSize: 12_000_000,
    mimeType: 'video/mp4',
    isCompressed: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockParams.from = 'gallery';
  mockVideo.galleryAllowed = true;
});

test('the gallery opens instead of the camera, and nothing is asked of the camera', async () => {
  pick.mockResolvedValue(picked());

  await render(<RecordRoute />);

  expect(pick).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('camera-preview')).toBeNull();
  expect(mockPermissions.asked).toEqual([]);
  expect(screen.getByTestId('video-preview')).toBeTruthy();
  expect(mockPreview.source).toBe(PICKED_URI);
});

test('while the gallery is open the screen says so', async () => {
  const choosing = deferred<PickedVideo | null>();
  pick.mockReturnValue(choosing.promise);

  await render(<RecordRoute />);

  expect(screen.getByText('Открываем галерею…')).toBeTruthy();
  await act(async () => choosing.resolve(null));
});

test('«Отправить» sends it to the same queue, declared as from the gallery', async () => {
  pick.mockResolvedValue(picked());
  keep.mockImplementation(async (_recording, source) => ({
    ...kept(20),
    source: source ?? 'camera',
  }));
  await render(<RecordRoute />);

  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));

  expect(keep).toHaveBeenCalledWith(
    expect.objectContaining({ uri: PICKED_URI, durationSec: 20 }),
    'gallery',
    'video/mp4',
  );
  expect(mockAttach).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: TASK_ID, stepId: STEP_ID, source: 'gallery' }),
  );
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('a video longer than the step allows is refused in her words, with another try and the way back', async () => {
  pick.mockResolvedValueOnce(picked({ durationSec: 120 })).mockResolvedValueOnce(picked());
  await render(<RecordRoute />);

  expect(
    screen.getByText('Это видео длиннее 90 с. Выберите покороче или снимите на камеру.'),
  ).toBeTruthy();
  expect(mockAttach).not.toHaveBeenCalled();
  expect(discardFile).toHaveBeenCalledWith(PICKED_URI);

  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать другое' }));

  expect(pick).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('video-preview')).toBeTruthy();
});

test('larger than the company allows, it says the size to meet', async () => {
  pick.mockResolvedValue(picked({ byteSize: 46_000_000 }));

  await render(<RecordRoute />);

  expect(
    screen.getByText('Это видео больше 45 МБ. Выберите поменьше или снимите на камеру.'),
  ).toBeTruthy();
  // The refusal's own «Назад», under the header's (record-header.tsx).
  const backs = screen.getAllByRole('button', { name: 'Назад' });
  expect(backs).toHaveLength(2);
  await fireEvent.press(backs[1]);
  expect(router.back).toHaveBeenCalledTimes(1);
});

// An iPhone's picker hands the video over compressed (capture.ts): one still
// too large after that is told so, and a shorter one is what can help.
test('compressed by the iPhone and still too large, it says so and asks for a shorter one', async () => {
  pick.mockResolvedValue(picked({ byteSize: 46_000_000, isCompressed: true }));

  await render(<RecordRoute />);

  expect(
    screen.getByText(
      'Даже после сжатия это видео больше 45 МБ. Выберите видео покороче или снимите на камеру.',
    ),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Выбрать другое' })).toBeTruthy();
});

test('a format the storage does not keep is refused before anything is sent', async () => {
  pick.mockResolvedValue(picked({ mimeType: 'video/webm' }));

  await render(<RecordRoute />);

  expect(
    screen.getByText(
      'Такое видео не подходит: нужен MP4 или MOV. Выберите другое или снимите на камеру.',
    ),
  ).toBeTruthy();
});

test('backing out of the gallery goes back to the step', async () => {
  pick.mockResolvedValue(null);

  await render(<RecordRoute />);

  expect(router.back).toHaveBeenCalledTimes(1);
});

test('a gallery that cannot be opened says why, and can be tried again', async () => {
  pick.mockRejectedValueOnce(new Error('library unavailable')).mockResolvedValueOnce(picked());
  await render(<RecordRoute />);

  expect(screen.getByText('library unavailable')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать другое' }));

  expect(screen.getByTestId('video-preview')).toBeTruthy();
});

test('«Выбрать другое» on the preview lets the chosen copy go and opens the gallery again', async () => {
  pick
    .mockResolvedValueOnce(picked())
    .mockResolvedValueOnce(picked({ uri: 'file:///cache/ImagePicker/b.mp4' }));
  await render(<RecordRoute />);

  await fireEvent.press(screen.getByRole('button', { name: 'Выбрать другое' }));

  expect(discardFile).toHaveBeenCalledWith(PICKED_URI);
  expect(pick).toHaveBeenCalledTimes(2);
  expect(mockPreview.source).toBe('file:///cache/ImagePicker/b.mp4');
});

test('leaving a chosen video unsent asks first, in words true of a gallery file', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  pick.mockResolvedValue(picked());
  await render(<RecordRoute />);

  await act(async () => mockLeaveGuard.onPrevented?.({ data: { action: { type: 'GO_BACK' } } }));

  expect(alert).toHaveBeenCalledWith(
    'Видео не отправлено',
    'Если уйти, видео не отправится. В галерее оно останется.',
    expect.any(Array),
    expect.anything(),
  );
  pressInAlert(alert, 'Остаться');
  alert.mockRestore();
});

test('without the company’s leave, the camera opens as before', async () => {
  mockVideo.galleryAllowed = false;

  await render(<RecordRoute />);

  expect(pick).not.toHaveBeenCalled();
  expect(screen.getByTestId('camera-preview')).toBeTruthy();
});
