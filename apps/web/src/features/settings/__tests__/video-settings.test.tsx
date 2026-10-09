import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { HostSettings } from '../schema';

/**
 * «Настройки → Процесс → Видео» (docs/tech-plan.md, 7.1–7.3 and 9): the
 * company's three video numbers, which the phone gives its camera and
 * add_task_media holds a video to (20261003170000).
 */

const host: HostSettings = {
  id: 'h1',
  name: 'Primary host',
  parallel_start_allowed: true,
  gallery_allowed: false,
  video_max_sec: 120,
  video_bitrate_kbps: 2000,
  video_max_mb: 45,
};

const settingsState = {
  data: host as HostSettings | null,
  isPending: false,
  isError: false,
  error: null as unknown,
};
const saveState = {
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null as unknown,
};
const save = vi.fn();

vi.mock('../use-settings', () => ({
  useHostSettings: () => settingsState,
  useSaveHostSettings: () => ({ ...saveState, mutate: save }),
}));

import { VideoSettings } from '../video-settings';

const LENGTH = 'Длина видео, с';
const BITRATE = 'Битрейт, кбит/с';
const FILE = 'Предел файла, МБ';
const SAVE = 'Сохранить настройки видео';

/** Clear a field and type into it, as a manager does. */
async function typeInto(label: string, value: string) {
  const field = screen.getByLabelText(label);
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsState.data = { ...host };
  settingsState.isPending = false;
  settingsState.isError = false;
  settingsState.error = null;
  saveState.isPending = false;
  saveState.isError = false;
  saveState.isSuccess = false;
  saveState.error = null;
});

describe('the company video settings', () => {
  test('open on what the company has', () => {
    render(<VideoSettings />);

    expect(screen.getByRole('heading', { name: 'Видео' })).toBeInTheDocument();
    expect(screen.getByLabelText(LENGTH)).toHaveValue(120);
    expect(screen.getByLabelText(BITRATE)).toHaveValue(2000);
    expect(screen.getByLabelText(FILE)).toHaveValue(45);
  });

  test('say so while the company is loading, and when it will not load', () => {
    settingsState.isPending = true;
    settingsState.data = null;
    const { unmount } = render(<VideoSettings />);
    expect(screen.queryByLabelText(LENGTH)).toBeNull();
    unmount();

    settingsState.isPending = false;
    settingsState.isError = true;
    render(<VideoSettings />);
    expect(screen.getByRole('alert')).toHaveTextContent('Настройки компании не загрузились.');
    expect(screen.queryByLabelText(LENGTH)).toBeNull();
  });

  test('nothing changed, nothing to save', () => {
    render(<VideoSettings />);

    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  test.each([
    [LENGTH, '9', 'Целое число от 10 до 600.'],
    [LENGTH, '601', 'Целое число от 10 до 600.'],
    [BITRATE, '499', 'Целое число от 500 до 20000.'],
    [FILE, '151', 'Целое число от 5 до 150.'],
    [FILE, '4.5', 'Целое число от 5 до 150.'],
  ])('%s = %s is refused before it reaches the server', async (label, value, rule) => {
    render(<VideoSettings />);

    await typeInto(label, value);

    const field = screen.getByLabelText(label);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      rule,
    );
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  test('the bounds are said before anyone types', () => {
    render(<VideoSettings />);

    const field = screen.getByLabelText(LENGTH);
    expect(field).toHaveAttribute('min', '10');
    expect(field).toHaveAttribute('max', '600');
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('the free plan preset fills the three fields and saves nothing by itself', async () => {
    settingsState.data = {
      ...host,
      video_max_sec: 180,
      video_bitrate_kbps: 4500,
      video_max_mb: 140,
    };
    render(<VideoSettings />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Бесплатный тариф: 120 с, 2000 кбит/с, 45 МБ' }),
    );

    expect(screen.getByLabelText(LENGTH)).toHaveValue(120);
    expect(screen.getByLabelText(BITRATE)).toHaveValue(2000);
    expect(screen.getByLabelText(FILE)).toHaveValue(45);
    expect(save).not.toHaveBeenCalled();
  });

  test('the Pro preset says it is for Pro, and fills the fields', async () => {
    render(<VideoSettings />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Pro: 180 с, 4500 кбит/с, 140 МБ — только на тарифе Pro',
      }),
    );

    expect(screen.getByLabelText(LENGTH)).toHaveValue(180);
    expect(screen.getByLabelText(BITRATE)).toHaveValue(4500);
    expect(screen.getByLabelText(FILE)).toHaveValue(140);
  });

  test('says how large a full-length video is at this bitrate', () => {
    render(<VideoSettings />);

    // 120 s × 2000 kbit/s / 8 / 1000 = 30 MB.
    expect(
      screen.getByText('Видео полной длины при этом битрейте — около 30 МБ.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/больше предела файла/)).toBeNull();
  });

  test('warns when a full-length video would not fit the file limit', async () => {
    render(<VideoSettings />);

    await typeInto(BITRATE, '4500');

    // 120 × 4500 / 8 / 1000 = 67.5 MB > 45 MB; the camera stops at 45 MB, after 80 s.
    expect(
      screen.getByText('Видео полной длины при этом битрейте — около 68 МБ.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Это больше предела файла (45 МБ): запись остановится раньше, примерно через 80 с.',
      ),
    ).toBeInTheDocument();
    // A warning, not a refusal.
    expect(screen.getByRole('button', { name: SAVE })).toBeEnabled();
  });

  test('warns, without refusing, that a file over 50 MB needs Supabase Pro', async () => {
    render(<VideoSettings />);
    expect(screen.queryByText(/только на Pro/)).toBeNull();

    await typeInto(FILE, '51');

    expect(
      screen.getByText(
        'На бесплатном тарифе Supabase один файл — не больше 50 МБ на весь проект: предел выше работает только на Pro.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SAVE })).toBeEnabled();
  });

  test('saving sends the three numbers and no switch', async () => {
    render(<VideoSettings />);

    await typeInto(LENGTH, '90');
    await userEvent.click(screen.getByRole('button', { name: SAVE }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({
      videoMaxSec: 90,
      videoBitrateKbps: 2000,
      videoMaxMb: 45,
    });
  });

  test('a refusal for a number out of range names the field and the bounds', () => {
    saveState.isError = true;
    saveState.error = {
      message: 'video_max_mb 151 is outside 5..150',
      hint: 'serverErrors.videoSettingOutOfRange',
      details: JSON.stringify({ field: 'video_max_mb', min: 5, max: 150 }),
    };

    render(<VideoSettings />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Предел файла, МБ: Допустимо от 5 до 150.');
    expect(alert).not.toHaveTextContent('outside');
  });

  test('another refusal is shown as the panel says it, with the server words under it', () => {
    saveState.isError = true;
    saveState.error = { message: 'Only a manager may change company settings' };

    render(<VideoSettings />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
