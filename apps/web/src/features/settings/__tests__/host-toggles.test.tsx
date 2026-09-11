import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { HostSettings } from '../schema';

const host: HostSettings = {
  id: 'h1',
  name: 'Primary host',
  parallel_start_allowed: true,
  gallery_allowed: false,
};

const settingsState = {
  data: host as HostSettings | null,
  isPending: false,
  isError: false,
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

import { HostToggles } from '../host-toggles';

beforeEach(() => {
  vi.clearAllMocks();
  settingsState.data = { ...host };
  settingsState.isPending = false;
  settingsState.isError = false;
  saveState.isPending = false;
  saveState.isError = false;
  saveState.isSuccess = false;
  saveState.error = null;
});

describe('the company switches', () => {
  test('the gallery is closed out of the box', () => {
    render(<HostToggles />);

    expect(screen.getByLabelText('Разрешить загрузку из галереи')).not.toBeChecked();
  });

  // The switch loosens what a photograph proves, and the screen has to say so
  // before it is pressed, not after somebody notices a picture of the wrong flat.
  test('and says what it costs before anyone presses it', () => {
    render(<HostToggles />);

    const described = screen
      .getByLabelText('Разрешить загрузку из галереи')
      .getAttribute('aria-describedby');
    const text = document.getElementById(described ?? '')?.textContent ?? '';

    expect(text).toContain('в другой квартире');
    expect(text).toContain('перестаёт быть свидетельством');
  });

  test('one switch covers photos and video together', () => {
    render(<HostToggles />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  test('opening the gallery sends that switch and no other', async () => {
    render(<HostToggles />);

    await userEvent.click(screen.getByLabelText('Разрешить загрузку из галереи'));

    expect(save).toHaveBeenCalledWith({ galleryAllowed: true });
  });

  test('and turning parallel starts off sends only that one', async () => {
    render(<HostToggles />);

    await userEvent.click(screen.getByLabelText('Разрешить параллельный старт'));

    expect(save).toHaveBeenCalledWith({ parallelStartAllowed: false });
  });

  test('a company that will not load says so instead of showing switches', () => {
    settingsState.isError = true;
    settingsState.data = null;

    render(<HostToggles />);

    expect(screen.getByRole('alert')).toHaveTextContent('Настройки компании не загрузились.');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  test('a refusal from the server is shown where it was pressed', () => {
    saveState.isError = true;
    saveState.error = { message: 'Only a manager may change company settings' };

    render(<HostToggles />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
