import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { EmptyState, ErrorState, LoadingState } from './states';

/**
 * The three states every list and card has (5.2). The words are the screen's;
 * an error follows CLAUDE.md: a translated sentence, and the server's own text
 * small under it, never alone on the screen.
 */
describe('the states of a screen', () => {
  test('loading and empty are one quiet line of the screen’s words', () => {
    render(
      <>
        <LoadingState>Загрузка…</LoadingState>
        <EmptyState>Уборок нет.</EmptyState>
      </>,
    );

    expect(screen.getByText('Загрузка…')).toHaveAttribute('data-slot', 'loading-state');
    expect(screen.getByText('Загрузка…')).toHaveClass('text-sm', 'text-muted-foreground');
    expect(screen.getByText('Уборок нет.')).toHaveAttribute('data-slot', 'empty-state');
  });

  test('an unknown error says the screen’s sentence and the server’s words small under it', () => {
    render(
      <ErrorState message="Не удалось загрузить уборки" error={{ message: 'fetch failed' }} />,
    );

    const alert = screen.getByRole('alert');
    expect(screen.getByText('Не удалось загрузить уборки')).toBeInTheDocument();
    expect(screen.getByText('fetch failed')).toHaveClass('text-xs');
    expect(alert).toHaveClass('text-destructive');
  });

  test('an error with a key of its own says it under the screen’s sentence', () => {
    render(
      <ErrorState
        message="Не удалось загрузить уборки"
        error={{ message: 'comment_empty', hint: 'serverErrors.commentEmpty' }}
      />,
    );

    expect(screen.getByText('Комментарий пуст')).toHaveClass('text-xs');
    expect(screen.queryByText('comment_empty')).not.toBeInTheDocument();
  });

  test('without a sentence of the screen’s, the general phrase leads', () => {
    render(<ErrorState error={{ message: 'fetch failed' }} />);

    expect(screen.getByRole('alert')).toHaveTextContent('fetch failed');
    expect(screen.getByRole('alert').firstElementChild).not.toHaveTextContent('fetch failed');
  });
});
