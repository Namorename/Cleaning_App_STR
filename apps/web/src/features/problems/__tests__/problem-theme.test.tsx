import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const PROBLEM_ID = '11111111-1111-4111-8111-111111111111';

const state: {
  read: { data?: unknown; isPending: boolean; isError: boolean };
  write: { mutate: ReturnType<typeof vi.fn>; isPending: boolean; isError: boolean; error: unknown };
} = {
  read: { isPending: false, isError: false },
  write: { mutate: vi.fn(), isPending: false, isError: false, error: null },
};

vi.mock('../use-problem-theme', () => ({
  useProblemTheme: () => state.read,
  useSetProblemTheme: () => state.write,
}));

import { ProblemThemeBlock } from '../problem-theme';

function open(data: unknown): void {
  state.read = { data, isPending: false, isError: false };
  render(<ProblemThemeBlock problemId={PROBLEM_ID} />);
}

beforeEach(() => {
  state.write = { mutate: vi.fn(), isPending: false, isError: false, error: null };
});

describe('ProblemThemeBlock', () => {
  test('says what the task is about and that the dictionary said so', () => {
    open({ theme: 'wifi', source: 'dict' });

    expect(screen.getByLabelText('Тема')).toHaveValue('wifi');
    expect(screen.getByText('Определена по словарю')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Вернуть автоматическую' })).not.toBeInTheDocument();
  });

  test('offers all the themes, and «без темы» only while there is none', () => {
    open(null);

    expect(screen.getByRole('option', { name: 'Без темы' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(36);
  });

  test('a choice is written at once', async () => {
    open({ theme: 'wifi', source: 'dict' });

    await userEvent.selectOptions(screen.getByLabelText('Тема'), 'tv');

    expect(state.write.mutate).toHaveBeenCalledWith('tv');
  });

  test('a hand can be taken away', async () => {
    open({ theme: 'tv', source: 'manual' });

    expect(screen.getByText('Задана вручную')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть автоматическую' }));

    expect(state.write.mutate).toHaveBeenCalledWith(null);
  });

  test('a refusal is translated', () => {
    state.write = {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: { message: 'Theme nope is not known', hint: 'serverErrors.problemThemeUnknown' },
    };
    open({ theme: 'wifi', source: 'dict' });

    expect(screen.getByRole('alert')).toHaveTextContent('Такой темы нет');
  });

  test('a failed read does not pretend there is no theme', () => {
    state.read = { isPending: false, isError: true };
    render(<ProblemThemeBlock problemId={PROBLEM_ID} />);

    expect(screen.getByText('Не удалось загрузить тему')).toBeInTheDocument();
    expect(screen.queryByLabelText('Тема')).not.toBeInTheDocument();
  });
});
