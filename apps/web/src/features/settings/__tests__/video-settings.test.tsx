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
/** As TanStack's: the mutation forgets how its last call ended. */
const reset = vi.fn(() => {
  saveState.isError = false;
  saveState.isSuccess = false;
  saveState.error = null;
});

vi.mock('../use-settings', () => ({
  useHostSettings: () => settingsState,
  useSaveHostSettings: () => ({ ...saveState, mutate: save, reset }),
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
  // A test that saves gives `save` a way to answer; the next one starts without it.
  save.mockReset();
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
    // The notes follow the field once it is left (see «spoken» below).
    await userEvent.tab();

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
    await userEvent.tab();

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

  // A later migration may bound a fourth number: its refusal still reads, without a field name.
  test('a refusal for a field this build does not know says only the bounds', () => {
    saveState.isError = true;
    saveState.error = {
      message: 'video_max_fps 61 is outside 15..60',
      hint: 'serverErrors.videoSettingOutOfRange',
      details: JSON.stringify({ field: 'video_max_fps', min: 15, max: 60 }),
    };

    render(<VideoSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent(/^Допустимо от 15 до 60\.$/);
  });
});

describe('the company video settings — saving', () => {
  test('a save puts the fields back on the company numbers and says it is saved', async () => {
    save.mockImplementation((_patch: unknown, options?: { onSuccess?: () => void }) => {
      saveState.isSuccess = true;
      options?.onSuccess?.();
    });
    render(<VideoSettings />);

    await typeInto(LENGTH, '90');
    await userEvent.click(screen.getByRole('button', { name: SAVE }));

    // The mock company still says 120: the draft is gone, not kept on screen.
    expect(screen.getByLabelText(LENGTH)).toHaveValue(120);
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');
    expect(screen.getByRole('button', { name: SAVE })).toBeDisabled();
  });

  test('Enter in a field saves, as a form does', async () => {
    render(<VideoSettings />);

    await typeInto(LENGTH, '90');
    await userEvent.type(screen.getByLabelText(LENGTH), '{Enter}');

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({
      videoMaxSec: 90,
      videoBitrateKbps: 2000,
      videoMaxMb: 45,
    });
  });

  test('Enter saves nothing while a number is out of bounds', async () => {
    render(<VideoSettings />);

    await typeInto(LENGTH, '9');
    await userEvent.type(screen.getByLabelText(LENGTH), '{Enter}');

    expect(save).not.toHaveBeenCalled();
  });

  test('editing a field after a save takes «Сохранено» away', async () => {
    saveState.isSuccess = true;
    render(<VideoSettings />);
    expect(screen.getByRole('status')).toHaveTextContent('Сохранено');

    await typeInto(LENGTH, '90');

    expect(reset).toHaveBeenCalled();
    expect(screen.queryByText('Сохранено')).toBeNull();
  });

  test('a preset and then «Отменить правки» do not bring an old «Сохранено» back', async () => {
    saveState.isSuccess = true;
    render(<VideoSettings />);

    await userEvent.click(
      screen.getByRole('button', { name: 'Бесплатный тариф: 120 с, 2000 кбит/с, 45 МБ' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Отменить правки' }));

    expect(reset).toHaveBeenCalled();
    expect(screen.queryByText('Сохранено')).toBeNull();
  });

  test('a refusal goes away once the manager edits a field', async () => {
    saveState.isError = true;
    saveState.error = { message: 'Only a manager may change company settings' };
    render(<VideoSettings />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await typeInto(LENGTH, '90');

    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('a refusal goes away once the manager picks a preset', async () => {
    saveState.isError = true;
    saveState.error = { message: 'Only a manager may change company settings' };
    render(<VideoSettings />);

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Pro: 180 с, 4500 кбит/с, 140 МБ — только на тарифе Pro',
      }),
    );

    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the company video settings — what a screen reader hears', () => {
  // A live region that changed on every key would read out a size for 4,
  // 45, 450 and 4500 in turn; it speaks once the manager leaves the field.
  test('the size notes are spoken when a field is left, not on every key', async () => {
    render(<VideoSettings />);
    const notes = screen.getByText('Видео полной длины при этом битрейте — около 30 МБ.')
      .parentElement as HTMLElement;
    expect(notes).toHaveAttribute('aria-live', 'polite');

    await typeInto(BITRATE, '4500');
    expect(notes).toHaveTextContent('около 30 МБ');

    await userEvent.tab();
    expect(notes).toHaveTextContent('около 68 МБ');
  });

  test('a preset is spoken at once: it is one press, not a run of keys', async () => {
    render(<VideoSettings />);
    const notes = screen.getByText('Видео полной длины при этом битрейте — около 30 МБ.')
      .parentElement as HTMLElement;

    await userEvent.click(
      screen.getByRole('button', {
        name: 'Pro: 180 с, 4500 кбит/с, 140 МБ — только на тарифе Pro',
      }),
    );

    // 180 × 4500 / 8 / 1000 = 101.25 MB.
    expect(notes).toHaveTextContent('около 101 МБ');
  });

  // Not a fault: the plan is the owner's choice, and the note only says what it allows.
  test('the free-plan note is said plainly, not in the colour of an error', async () => {
    render(<VideoSettings />);

    await typeInto(FILE, '51');
    await userEvent.tab();

    const note = screen.getByText(/На бесплатном тарифе Supabase/);
    expect(note).not.toHaveClass('text-destructive');
    expect(note).toHaveClass('text-muted-foreground');
  });
});

describe('the company video settings — targets', () => {
  // Design decision 5: every target other than the phone's main buttons is at least 48.
  test('each preset is a 48 px target', () => {
    render(<VideoSettings />);

    for (const name of [/Бесплатный тариф/, /^Pro:/]) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-12');
    }
  });
});
