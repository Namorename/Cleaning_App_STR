import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { candidateKinds } from '@/features/guest-signals/schema';

import { GuestTaskSources } from '../guest-task-sources';

const state = { reviewTasks: true, chats: true };
const updateReviews = vi.fn();
const setChats = vi.fn();
const idle = { isPending: false, isError: false, error: null, reset: vi.fn() };
const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, error: null });

vi.mock('@/features/guest-signals/use-guest-signals', () => ({
  useSignalSettings: () => loaded({ tasks_enabled: state.reviewTasks }),
  useChatsOn: () => loaded(state.chats),
  useUpdateSettings: () => ({ ...idle, mutate: updateReviews }),
  useSetGuestChats: () => ({ ...idle, mutate: setChats }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.reviewTasks = true;
  state.chats = true;
});

describe('«Задания от гостей» (owner, 2026-11-19)', () => {
  test('an admin switches the tasks from reviews off at once', async () => {
    render(<GuestTaskSources isAdmin />);

    await userEvent.click(screen.getByLabelText('Задания из отзывов'));

    expect(updateReviews).toHaveBeenCalledWith({ tasksEnabled: false });
  });

  test('switching chats off asks first and says that what comes meanwhile is never read', async () => {
    render(<GuestTaskSources isAdmin />);

    await userEvent.click(screen.getByLabelText('Задания из чатов'));
    const asked = screen.getByRole('dialog', { name: 'Выключить задания из чатов?' });
    expect(asked).toHaveTextContent('не будут прочитаны и после включения');
    expect(setChats).not.toHaveBeenCalled();

    await userEvent.click(within(asked).getByRole('button', { name: 'Отмена' }));
    expect(setChats).not.toHaveBeenCalled();

    await userEvent.click(screen.getByLabelText('Задания из чатов'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Выключить' }),
    );
    expect(setChats).toHaveBeenCalledWith(false);
  });

  test('switching chats on asks nothing', async () => {
    state.chats = false;
    render(<GuestTaskSources isAdmin />);

    await userEvent.click(screen.getByLabelText('Задания из чатов'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(setChats).toHaveBeenCalledWith(true);
  });

  test('a manager reads both and changes neither', () => {
    render(<GuestTaskSources isAdmin={false} />);

    expect(screen.getByText('Эти выключатели меняет только админ.')).toBeInTheDocument();
    expect(screen.getByLabelText('Задания из отзывов')).toBeDisabled();
    expect(screen.getByLabelText('Задания из чатов')).toBeDisabled();
  });
});

describe('candidateKinds', () => {
  test.each([
    [true, true, ['review', 'message']],
    [true, false, ['review']],
    [false, true, ['message']],
    [false, false, []],
  ] as const)('reviews %s, chats %s: %j', (reviews, chats, kinds) => {
    expect(candidateKinds(reviews, chats)).toEqual(kinds);
  });
});
