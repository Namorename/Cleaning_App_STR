import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MediaGallery, type GalleryFile } from '../media-gallery';

/**
 * The panel's one viewer of photos and videos, as a manager meets it: from a
 * thumbnail, over the page, with every file signed only when it is opened.
 */

const mocks = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));

vi.mock('@/lib/supabase/use-client', () => ({
  useSupabase: () => ({ storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) } }),
}));

const file = (id: string, overrides: Partial<GalleryFile> = {}): GalleryFile => ({
  id,
  storage_path: `h/t/${id}.jpg`,
  created_at: '2026-10-09T09:00:00+00:00',
  kind: 'photo',
  source: 'camera',
  url: `https://list/${id}.jpg`,
  ...overrides,
});

const FILES: GalleryFile[] = [
  file('p1'),
  file('p2'),
  file('p3'),
  file('v1', { storage_path: 'h/t/v1.mp4', kind: 'video', duration_sec: 65, url: null }),
];

// jsdom has no PointerEvent, and without it two fingers are one pointer.
if (typeof window.PointerEvent === 'undefined') {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: TestPointerEvent });
}

/** What a fetched photo hands over: a marker the object URL is named after. */
type FakeBlob = { path: string };

let signed = 0;
const fetchFile = vi.fn();
const revoked: string[] = [];

const signedUrl = (path: string, download?: string) =>
  `https://signed/${path}?n=${(signed += 1)}${download === undefined ? '' : `&download=${download}`}`;
const pathOf = (url: string) => /^https:\/\/signed\/([^?]+)/.exec(url)?.[1] ?? url;
const photoAnswer = (url: string) => ({
  ok: true,
  status: 200,
  blob: async () => ({ path: pathOf(url) }) as FakeBlob,
});

beforeEach(() => {
  signed = 0;
  revoked.length = 0;
  mocks.createSignedUrl.mockReset();
  mocks.createSignedUrl.mockImplementation(
    async (path: string, _seconds: number, options?: { download?: string }) => ({
      data: { signedUrl: signedUrl(path, options?.download) },
      error: null,
    }),
  );
  fetchFile.mockReset();
  fetchFile.mockImplementation(async (url: string) => photoAnswer(url));
  vi.stubGlobal('fetch', fetchFile);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: FakeBlob) => `blob:${blob.path}`,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
  // jsdom has no player: a viewer closing pauses one.
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  // Unmounted while the player's stand-in still holds.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderGallery = () => {
  const user = userEvent.setup();
  render(<MediaGallery files={FILES} title="Фото после уборки" />);
  return user;
};

const thumbnail = (name: string) => screen.getByRole('button', { name });
const photoShown = (position: number) =>
  screen.findByRole('img', { name: `Фото ${position} из 4` });

describe('opening and closing', () => {
  test('nothing is signed or loaded until a thumbnail is opened', () => {
    renderGallery();

    expect(thumbnail('Открыть фото 1 из 4').querySelector('img')).toHaveAttribute(
      'src',
      'https://list/p1.jpg',
    );
    expect(document.querySelector('a[target="_blank"]')).toBeNull();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
    expect(fetchFile).not.toHaveBeenCalled();
  });

  test('opens over the page on a thumbnail, from a link signed then, past the cache', async () => {
    const user = renderGallery();

    await user.click(thumbnail('Открыть фото 1 из 4'));

    expect(screen.getByRole('dialog', { name: 'Фото после уборки' })).toBeInTheDocument();
    expect(screen.getByText('1 из 4')).toBeInTheDocument();
    expect(await photoShown(1)).toHaveAttribute('src', 'blob:h/t/p1.jpg');
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('h/t/p1.jpg', 3600);
    expect(fetchFile).toHaveBeenCalledWith(
      expect.stringContaining('https://signed/h/t/p1.jpg'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  test('closes on its button, and the focus goes back to the thumbnail', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    await photoShown(1);

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(thumbnail('Открыть фото 1 из 4')).toHaveFocus();
  });

  test('closes on Esc, and the focus goes to the thumbnail of the file last shown', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    await photoShown(1);
    await user.keyboard('{ArrowRight}');
    await photoShown(2);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(thumbnail('Открыть фото 2 из 4')).toHaveFocus();
  });

  test('closes on a click on the dark around the photo, not on the photo', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    const photo = await photoShown(1);

    await user.click(photo);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(photo.parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('a drag that ends on the dark does not close it', async () => {
    renderGallery();
    fireEvent.click(thumbnail('Открыть фото 1 из 4'));
    const photo = await photoShown(1);
    const stage = photo.parentElement as HTMLElement;

    fireEvent.pointerDown(photo, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 100 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 160, clientY: 100 });
    fireEvent.click(stage);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('takes the focus inside on opening, onto its close button, and hides the page', async () => {
    const user = renderGallery();

    await user.click(thumbnail('Открыть фото 1 из 4'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Закрыть' })).toHaveFocus());
    // The thumbnails behind are out of reach while it is open.
    expect(screen.queryByRole('button', { name: 'Открыть фото 1 из 4' })).toBeNull();
  });
});

describe('walking through the set', () => {
  test('goes forward and back with the buttons and the arrow keys, «2 из 4»', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    await photoShown(1);

    expect(screen.getByRole('button', { name: 'Назад' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Вперёд' }));
    expect(screen.getByText('2 из 4')).toBeInTheDocument();
    await photoShown(2);

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(screen.getByText('4 из 4')).toBeInTheDocument();
    // At the end the button says so and keeps the focus it holds.
    await user.click(screen.getByRole('button', { name: 'Вперёд' }));
    expect(screen.getByText('4 из 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Вперёд' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Вперёд' })).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('3 из 4')).toBeInTheDocument();
  });

  test('loads the photo on screen and its neighbours, not the whole set', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    await photoShown(1);

    await waitFor(() => expect(fetchFile).toHaveBeenCalledTimes(2));
    const fetched = fetchFile.mock.calls.map(([url]) => pathOf(url as string));
    expect(fetched.sort()).toEqual(['h/t/p1.jpg', 'h/t/p2.jpg']);

    // On the third photo the first is let go of: its bytes leave memory.
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await photoShown(3);
    expect(revoked).toContain('blob:h/t/p1.jpg');
  });
});

describe('looking closely at a photo', () => {
  /** A 4000×3000 photo on a 1000×600 stage: fitted at 20 %. */
  const measured = async () => {
    const photo = await photoShown(1);
    const stage = photo.parentElement as HTMLElement;
    Object.defineProperty(photo, 'naturalWidth', { configurable: true, value: 4000 });
    Object.defineProperty(photo, 'naturalHeight', { configurable: true, value: 3000 });
    stage.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 }) as DOMRect;
    fireEvent.load(photo);
    return { photo, stage };
  };
  const zoomShown = () => screen.getByRole('group', { name: 'Масштаб' });

  test('zooms with the buttons, 100 % and fitted, and with the keys', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    const { photo } = await measured();
    expect(zoomShown()).toHaveTextContent('20 %');

    await user.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(zoomShown()).toHaveTextContent('30 %');
    expect(photo.style.transform).toContain('scale(0.3');

    await user.click(screen.getByRole('button', { name: 'Исходный размер, 100 %' }));
    expect(zoomShown()).toHaveTextContent('100 %');

    await user.click(screen.getByRole('button', { name: 'По размеру окна' }));
    expect(zoomShown()).toHaveTextContent('20 %');
    expect(photo.style.transform).toBe('');

    await user.keyboard('+');
    expect(zoomShown()).toHaveTextContent('30 %');
    await user.keyboard('0');
    expect(zoomShown()).toHaveTextContent('20 %');
  });

  test('zooms with the wheel and a double click, and drags once zoomed', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    const { photo, stage } = await measured();

    fireEvent.wheel(stage, { deltaY: -400, clientX: 500, clientY: 300 });
    expect(zoomShown()).not.toHaveTextContent('20 %');

    fireEvent.doubleClick(photo, { clientX: 500, clientY: 300 });
    expect(zoomShown()).toHaveTextContent('20 %');
    fireEvent.doubleClick(photo, { clientX: 500, clientY: 300 });
    expect(zoomShown()).toHaveTextContent('100 %');

    const before = photo.style.transform;
    fireEvent.pointerDown(photo, { pointerId: 1, clientX: 500, clientY: 300 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 400, clientY: 250 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 400, clientY: 250 });
    expect(photo.style.transform).not.toBe(before);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('two fingers pinch it closer', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    const { photo, stage } = await measured();

    fireEvent.pointerDown(photo, { pointerId: 1, clientX: 450, clientY: 300 });
    fireEvent.pointerDown(photo, { pointerId: 2, clientX: 550, clientY: 300 });
    fireEvent.pointerMove(stage, { pointerId: 2, clientX: 750, clientY: 300 });

    expect(zoomShown()).toHaveTextContent('60 %');
  });
});

describe('a link that does not open', () => {
  test('one that has expired is signed again once, and the photo shows', async () => {
    fetchFile.mockImplementationOnce(async () => ({ ok: false, status: 400 }));
    const user = renderGallery();

    await user.click(thumbnail('Открыть фото 1 из 4'));

    expect(await photoShown(1)).toHaveAttribute('src', 'blob:h/t/p1.jpg');
    const signings = mocks.createSignedUrl.mock.calls.filter(([path]) => path === 'h/t/p1.jpg');
    expect(signings).toHaveLength(2);
  });

  test('one that fails again says so, and tries again on request', async () => {
    fetchFile.mockImplementation(async (url: string) =>
      pathOf(url) === 'h/t/p1.jpg' ? { ok: false, status: 400 } : photoAnswer(url),
    );
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));

    expect(await screen.findByText('Не удалось загрузить файл.')).toBeInTheDocument();

    fetchFile.mockImplementation(async (url: string) => photoAnswer(url));
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await photoShown(1)).toHaveAttribute('src', 'blob:h/t/p1.jpg');
  });

  test('a file the retention has removed is said to be gone', async () => {
    mocks.createSignedUrl.mockImplementation(async () => ({
      data: null,
      error: { statusCode: '404', message: 'Object not found' },
    }));
    const user = renderGallery();

    await user.click(thumbnail('Открыть фото 1 из 4'));

    expect(
      await screen.findByText('Файл удалён по сроку хранения (90 дней).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скачать' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(fetchFile).not.toHaveBeenCalled();
  });

  test('bytes that arrive but will not draw say so, and try again on request', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    const photo = await photoShown(1);

    fireEvent.error(photo);

    expect(await screen.findByText('Не удалось загрузить файл.')).toBeInTheDocument();
    expect(revoked).toContain('blob:h/t/p1.jpg');
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await photoShown(1)).toHaveAttribute('src', 'blob:h/t/p1.jpg');
  });
});

describe('downloading', () => {
  /** What the page's links were pressed with: never a signed link. */
  const pressedLinks = () => {
    const clicks: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
    return clicks;
  };

  test('saves a photo from the bytes it holds, under a clear name, without leaving the page', async () => {
    const clicks = pressedLinks();
    const here = window.location.href;
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    await photoShown(1);
    const signedBefore = mocks.createSignedUrl.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Скачать' }));

    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0].href).toBe('blob:h/t/p1.jpg');
    expect(clicks[0].download).toMatch(/^photo-2026-10-09-\d{4}-1\.jpg$/);
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(signedBefore);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(window.location.href).toBe(here);
  });

  test('saves a video by fetching it into memory first, never by its link', async () => {
    const clicks = pressedLinks();
    const user = renderGallery();
    await user.click(thumbnail('Открыть видео 4 из 4'));
    await screen.findByLabelText('Видео 4 из 4');

    await user.click(screen.getByRole('button', { name: 'Скачать' }));

    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0].href).toBe('blob:h/t/v1.mp4');
    expect(clicks[0].download).toMatch(/^video-2026-10-09-\d{4}-4\.mp4$/);
    expect(fetchFile).toHaveBeenCalledWith(
      expect.stringContaining('https://signed/h/t/v1.mp4'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  test('says so when storage will not hand the file over, and stays on the page', async () => {
    const clicks = pressedLinks();
    const user = renderGallery();
    await user.click(thumbnail('Открыть видео 4 из 4'));
    await screen.findByLabelText('Видео 4 из 4');
    fetchFile.mockImplementation(async () => ({ ok: false, status: 500 }));

    await user.click(screen.getByRole('button', { name: 'Скачать' }));

    expect(
      await screen.findByText('Не удалось скачать файл. Попробуйте ещё раз.'),
    ).toBeInTheDocument();
    expect(clicks).toEqual([]);
  });
});

describe('the keys of the browser', () => {
  test('a key pressed with Ctrl or Alt is left to the browser', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть фото 1 из 4'));
    await photoShown(1);

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await user.keyboard('{Control>}{ArrowRight}{/Control}');

    expect(screen.getByText('1 из 4')).toBeInTheDocument();
  });
});

describe('a list read again while the viewer is open', () => {
  test('keeps the viewer on the same file when one is added before it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MediaGallery files={FILES} title="Фото после уборки" />);
    await user.click(thumbnail('Открыть фото 2 из 4'));
    await photoShown(2);

    rerender(<MediaGallery files={[file('p0'), ...FILES]} title="Фото после уборки" />);

    expect(screen.getByText('3 из 5')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Фото 3 из 5' })).toHaveAttribute(
      'src',
      'blob:h/t/p2.jpg',
    );
  });

  test('closes when the file it showed is gone from the list', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MediaGallery files={FILES} title="Фото после уборки" />);
    await user.click(thumbnail('Открыть фото 2 из 4'));
    await photoShown(2);

    rerender(<MediaGallery files={FILES.filter((one) => one.id !== 'p2')} />);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    rerender(<MediaGallery files={FILES} title="Фото после уборки" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a video', () => {
  test('plays in the same window, with the usual controls, and pauses on close', async () => {
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const user = renderGallery();

    expect(thumbnail('Открыть видео 4 из 4')).toHaveTextContent('1:05');
    expect(document.querySelector('video')).toBeNull();

    await user.click(thumbnail('Открыть видео 4 из 4'));
    const video = await screen.findByLabelText('Видео 4 из 4');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('src')).toContain('https://signed/h/t/v1.mp4');
    // A video streams: it is not fetched into memory.
    expect(fetchFile.mock.calls.map(([url]) => pathOf(url as string))).not.toContain(
      'h/t/v1.mp4',
    );

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pause).toHaveBeenCalled();
  });

  test('a link the player cannot open is signed again once, then said to have failed', async () => {
    const user = renderGallery();
    await user.click(thumbnail('Открыть видео 4 из 4'));
    const first = await screen.findByLabelText('Видео 4 из 4');
    const firstLink = first.getAttribute('src');

    act(() => {
      fireEvent.error(first);
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Видео 4 из 4').getAttribute('src')).not.toBe(firstLink),
    );

    act(() => {
      fireEvent.error(screen.getByLabelText('Видео 4 из 4'));
    });
    expect(await screen.findByText('Не удалось загрузить файл.')).toBeInTheDocument();
  });
});
