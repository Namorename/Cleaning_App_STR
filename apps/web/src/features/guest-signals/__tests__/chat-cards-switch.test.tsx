import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ChatCardsSwitch } from '../chat-cards-switch';
import { candidateKinds, kindsOf } from '../schema';

const state = { chats: true as boolean | undefined };
const setChats = vi.fn();
const idle = { isPending: false, isError: false, error: null, reset: vi.fn() };

vi.mock('../use-guest-signals', () => ({
  useChatsOn: () => ({ data: state.chats, isPending: state.chats === undefined, isError: false }),
  useSetGuestChats: () => ({ ...idle, mutate: setChats }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.chats = true;
  // jsdom has no PointerEvent; Base UI's switch builds one on a press (as in ui/primitives.test).
  if (typeof window.PointerEvent !== 'function') {
    Object.defineProperty(window, 'PointerEvent', {
      configurable: true,
      value: class PointerEvent extends MouseEvent {},
    });
  }
});

describe('«Карточки из чатов» in the settings of «Гости» (owner, 2026-11-26)', () => {
  test('an admin switching it off is asked first, then the chats switch goes off', async () => {
    render(<ChatCardsSwitch isAdmin />);

    await userEvent.click(screen.getByRole('switch', { name: 'Карточки из чатов' }));
    const asked = screen.getByRole('dialog', { name: 'Выключить задания из чатов?' });
    expect(setChats).not.toHaveBeenCalled();

    await userEvent.click(within(asked).getByRole('button', { name: 'Выключить' }));
    expect(setChats).toHaveBeenCalledWith(false);
  });

  test('switching it on asks nothing', async () => {
    state.chats = false;
    render(<ChatCardsSwitch isAdmin />);

    await userEvent.click(screen.getByRole('switch', { name: 'Карточки из чатов' }));

    expect(setChats).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a manager sees it and its words, and cannot press it', () => {
    render(<ChatCardsSwitch isAdmin={false} />);

    expect(screen.getByRole('switch', { name: 'Карточки из чатов' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText(/модель для чатов не вызывается/)).toBeInTheDocument();
  });

  test('while the switch is not read it cannot be pressed', () => {
    state.chats = undefined;
    render(<ChatCardsSwitch isAdmin />);

    expect(screen.getByRole('switch', { name: 'Карточки из чатов' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('off: no card from chats is listed or offered, in any tab', () => {
    expect(kindsOf('all', false)).toEqual(['review']);
    expect(kindsOf('message', false)).toEqual(['review']);
    expect(candidateKinds(true, false)).toEqual(['review']);
    expect(candidateKinds(true, true)).toEqual(['review', 'message']);
  });
});
