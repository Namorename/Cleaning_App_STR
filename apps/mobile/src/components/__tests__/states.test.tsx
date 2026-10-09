import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { RefusalError } from '@/lib/server-error';

import { EmptyState } from '../empty-state';
import { ErrorBanner } from '../error-banner';
import { ErrorState } from '../error-state';

/**
 * "Nothing to do" and "could not load" mean opposite things to a cleaner in a
 * doorway; both are words a screen reader can reach. A failure says the
 * sentence in her language and the server's own words small under it, for her
 * to forward (CLAUDE.md) — never the raw message alone.
 */

describe('EmptyState', () => {
  test('says what is empty, and offers the way on', async () => {
    const onPress = jest.fn();
    await render(
      <EmptyState
        title="Свободных уборок нет"
        message="Потяните список вниз, чтобы обновить."
        action={{ label: 'Обновить', onPress }}
      />,
    );

    expect(screen.getByText('Свободных уборок нет')).toBeTruthy();
    expect(screen.getByText('Потяните список вниз, чтобы обновить.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Обновить' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('keeps a slot for the picture', async () => {
    await render(<EmptyState title="Пусто" icon={<Text>[icon]</Text>} />);

    expect(screen.getByText('[icon]')).toBeTruthy();
  });
});

describe('ErrorState', () => {
  test('an unknown failure: the general sentence, the server’s words small under it', async () => {
    await render(
      <ErrorState
        title="Не удалось загрузить уборки"
        error={new Error('Network request failed')}
      />,
    );

    expect(screen.getByText('Не удалось загрузить уборки')).toBeTruthy();
    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  test('a refusal the app knows is said in her words, with nothing raw under it', async () => {
    const refusal = new RefusalError('Claim matched no row', 'tasks.claimTaken');
    await render(<ErrorState error={refusal} />);

    expect(screen.queryByText('Claim matched no row')).toBeNull();
  });

  test('is announced, and offers to try again', async () => {
    const onRetry = jest.fn();
    await render(<ErrorState error={new Error('boom')} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBanner', () => {
  test('a line over the list: what happened, and the server’s words small', async () => {
    await render(
      <ErrorBanner
        title="Не удалось обновить — показан сохранённый список."
        error={new Error('Network request failed')}
      />,
    );

    expect(screen.getByText('Не удалось обновить — показан сохранённый список.')).toBeTruthy();
    expect(screen.getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
