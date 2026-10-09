import { THEME_COLORS, TONE_COLORS, TOUCH_TARGET } from '@str-ops/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

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

  // Only the stranded one can be retried; every one can be taken back. Each
  // button is named with its tile, so the reader knows which photo it acts on.
  expect(screen.getAllByRole('button', { name: /^Повторить загрузку/ })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить загрузку. Фото 3' }));
  expect(handlers.onRetry).toHaveBeenCalledWith('m3');

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить. Фото 2' }));
  expect(handlers.onRemove).toHaveBeenCalledWith('m2');
});

test('a video tile’s button is named with the video', async () => {
  await render(
    <StepMedia
      kind="video"
      items={[item({ kind: 'video', uri: null, durationSec: 20.5, status: 'failed' })]}
      limits={{ min: 1, max: 1 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Удалить. Видео' }));
  expect(handlers.onRemove).toHaveBeenCalledWith('m1');
  expect(screen.getByRole('button', { name: 'Повторить загрузку. Видео' })).toBeTruthy();
});

test('while the camera is open, the camera button spins and the gallery waits', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[]}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={30}
      isCapturing
      disabled={false}
      {...handlers}
      canPickFromGallery
    />,
  );

  const camera = screen.getByRole('button', { name: 'Снять фото' });
  const gallery = screen.getByRole('button', { name: 'Выбрать фото из галереи' });
  expect(camera.props.accessibilityState).toMatchObject({ busy: true });
  expect(gallery).toBeDisabled();
  expect(gallery.props.accessibilityState).toMatchObject({ busy: false });

  await fireEvent.press(camera);
  await fireEvent.press(gallery);
  expect(handlers.onCapture).not.toHaveBeenCalled();
  expect(handlers.onPickFromGallery).not.toHaveBeenCalled();
});

// A tile whose picture is not here yet (its signed link still on the way)
// says what it holds, not which step: the same tiles serve "photos after".
test('a photo not here yet is called a photo, not a photo before', async () => {
  await render(
    <StepMedia
      kind="photo"
      items={[item({ uri: null })]}
      limits={{ min: 1, max: 4 }}
      maxVideoSec={30}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByText('Фото')).toBeTruthy();
  expect(screen.queryByText('Фото до')).toBeNull();
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

describe('a video on its way', () => {
  function renderVideo(overrides: Partial<MediaItemView>) {
    return render(
      <StepMedia
        kind="video"
        items={[item({ kind: 'video', uri: null, durationSec: 20.5, ...overrides })]}
        limits={{ min: 1, max: 10 }}
        maxVideoSec={90}
        isCapturing={false}
        disabled={false}
        {...handlers}
      />,
    );
  }

  // The number is the bar's to say, as a progress bar's value: the tile's
  // words say only what it is and that it is on its way.
  test('shows how much of it has gone, to the eye and to the reader, with its length', async () => {
    await renderVideo({ status: 'uploading', progress: 0.426 });

    const tile = screen.getByLabelText('Видео. Загружается…');
    expect(tile.props.accessibilityValue).toBeUndefined();
    const bar = screen.getByRole('progressbar', { name: 'Видео' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 42 });
    expect(screen.getByText('Загружается… 42 %')).toBeTruthy();
    expect(screen.getByText('Видео · 20.5 с')).toBeTruthy();
    expect(screen.getByTestId('media-progress-fill').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ width: '42%' })]),
    );
  });

  test('before its first piece has gone, says it is on its way, without a number', async () => {
    await renderVideo({ status: 'uploading' });

    const tile = screen.getByLabelText('Видео. Загружается…');
    expect(tile.props.accessibilityValue).toBeUndefined();
    expect(screen.queryByTestId('media-progress-fill')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  test('waiting for signal says so, not that it is uploading', async () => {
    await renderVideo({ status: 'uploading', progress: 0.42, isWaitingForNetwork: true });

    const tile = screen.getByLabelText('Видео. Ждёт сети');
    expect(tile.props.accessibilityValue).toBeUndefined();
    expect(screen.getByText('Ждёт сети')).toBeTruthy();
    expect(screen.getByText('Видео · 20.5 с')).toBeTruthy();
    // Paused, not spinning: the glyph of a pause beside the words.
    const box = within(tile).getByTestId('media-status-icon', { includeHiddenElements: true });
    const [drawing] = box.children;
    expect(String(typeof drawing === 'object' ? drawing.props.className : drawing)).toContain(
      'lucide-pause',
    );
  });

  // Its upload runs on in the queue whatever the screen says: «Удалить» would
  // take the row away under it. Once in, or failed, it can be removed.
  test('offers no «Удалить» while it is on its way, and does once it is in', async () => {
    const { rerender } = await renderVideo({ status: 'uploading', progress: 0.4 });

    expect(screen.queryByRole('button', { name: 'Удалить. Видео' })).toBeNull();

    await rerender(
      <StepMedia
        kind="video"
        items={[item({ kind: 'video', uri: null, durationSec: 20.5, status: 'uploaded' })]}
        limits={{ min: 1, max: 10 }}
        maxVideoSec={90}
        isCapturing={false}
        disabled={false}
        {...handlers}
      />,
    );
    expect(screen.getByRole('button', { name: 'Удалить. Видео' })).toBeTruthy();
  });

  test('once it has arrived, the number goes', async () => {
    await renderVideo({ status: 'uploaded', progress: 1 });

    expect(screen.getByLabelText('Видео. Загружено').props.accessibilityValue).toBeUndefined();
    expect(screen.queryByTestId('media-progress-fill')).toBeNull();
  });
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

// A video is shot with the app's own camera, whatever the company says about
// the gallery (docs/tech-plan.md §7.1): the server refuses a picked one
// (`videoCameraOnly`), so offering it would only lead to that refusal.
test('a video step offers the camera alone, even where the gallery is open', async () => {
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

  expect(screen.getByRole('button', { name: 'Записать видео' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /галере/ })).toBeNull();
});

test('the hint says the length the step will really accept', async () => {
  await render(
    <StepMedia
      kind="video"
      items={[]}
      limits={{ min: 1, max: 1 }}
      maxVideoSec={90}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  expect(screen.getByText('Запишите одно видео до 90 с')).toBeTruthy();
});

// Until the company's numbers are known — never read and no signal — the
// phone does not guess a length: the button waits, and says why.
test('while the company’s video settings are unknown, recording waits and says why', async () => {
  await render(
    <StepMedia
      kind="video"
      items={[]}
      limits={{ min: 1, max: 1 }}
      maxVideoSec={null}
      isCapturing={false}
      disabled={false}
      {...handlers}
    />,
  );

  const record = screen.getByRole('button', { name: 'Записать видео' });
  expect(record).toBeDisabled();
  expect(
    screen.getByText('Настройки видео ещё не получены. Нужна связь — попробуйте позже.'),
  ).toBeTruthy();
  expect(screen.queryByText(/Запишите одно видео/)).toBeNull();

  await fireEvent.press(record);
  expect(handlers.onCapture).not.toHaveBeenCalled();
});

describe('the look: «Абрикос» on the old layout', () => {
  const light = THEME_COLORS.light;
  const tones = TONE_COLORS.light;

  function styleOf(element: { props: { style?: unknown } }): ViewStyle {
    return StyleSheet.flatten(element.props.style as ViewStyle);
  }

  /** The Lucide glyph drawn in the icon with this test id inside `container`. */
  function glyphIn(container: Parameters<typeof within>[0], testID: string): string {
    const box = within(container).getByTestId(testID, { includeHiddenElements: true });
    const [drawing] = box.children;
    if (drawing === undefined || typeof drawing === 'string') {
      throw new Error(`${testID} holds no drawing`);
    }
    return String(drawing.props.className);
  }

  test('the camera is the main button, 56 dp, with the camera icon; the gallery a framed one', async () => {
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

    const capture = screen.getByRole('button', { name: 'Снять фото' });
    expect(styleOf(capture)).toMatchObject({
      minHeight: TOUCH_TARGET.phoneButton,
      backgroundColor: light.cta,
    });
    expect(glyphIn(capture, 'capture-icon')).toContain('lucide-camera');
    const gallery = screen.getByRole('button', { name: 'Выбрать фото из галереи' });
    expect(styleOf(gallery)).toMatchObject({
      minHeight: TOUCH_TARGET.phoneButton,
      borderColor: light.primary,
    });
  });

  test('a tile’s own buttons are big enough for a finger; removing is the destructive one', async () => {
    await render(
      <StepMedia
        kind="photo"
        items={[item({ id: 'm3', status: 'failed', uri: null })]}
        limits={{ min: 1, max: 4 }}
        maxVideoSec={30}
        isCapturing={false}
        disabled={false}
        {...handlers}
      />,
    );

    const retry = styleOf(screen.getByRole('button', { name: 'Повторить загрузку. Фото 1' }));
    const remove = styleOf(screen.getByRole('button', { name: 'Удалить. Фото 1' }));
    expect(retry.minHeight).toBeGreaterThanOrEqual(TOUCH_TARGET.phoneMin);
    expect(remove.minHeight).toBeGreaterThanOrEqual(TOUCH_TARGET.phoneMin);
    expect(remove.backgroundColor).toBe(tones.urgent.bg);
  });

  test('a tile’s buttons carry their words alone: no icon to crowd them at a large font', async () => {
    await render(
      <StepMedia
        kind="photo"
        items={[item({ id: 'm3', status: 'failed', uri: null })]}
        limits={{ min: 1, max: 4 }}
        maxVideoSec={30}
        isCapturing={false}
        disabled={false}
        {...handlers}
      />,
    );

    // The button holds its label and nothing beside it.
    for (const name of ['Повторить загрузку. Фото 1', 'Удалить. Фото 1']) {
      const button = screen.getByRole('button', { name });
      expect(button.children).toHaveLength(1);
    }
  });

  test('a tile shows where its file stands with an icon as well as words', async () => {
    await render(
      <StepMedia
        kind="photo"
        items={[item(), item({ id: 'm2', status: 'failed', uri: null })]}
        limits={{ min: 1, max: 4 }}
        maxVideoSec={30}
        isCapturing={false}
        disabled={false}
        {...handlers}
      />,
    );

    expect(glyphIn(screen.getByLabelText('Фото 1. Загружено'), 'media-status-icon')).toContain(
      'lucide-check',
    );
    expect(glyphIn(screen.getByLabelText('Фото 2. Не загрузилось'), 'media-status-icon')).toContain(
      'lucide-triangle-alert',
    );
  });
});
