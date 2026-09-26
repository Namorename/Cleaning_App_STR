import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { forgetSavedQueries } from '@/lib/query-client';

import { RootRouteError, RouteError, markAppDrawn } from '../route-error';

// The real one reaches for the disk; here it only has to be seen being asked.
jest.mock('@/lib/query-client', () => ({ forgetSavedQueries: jest.fn(async () => {}) }));

test('says the screen failed in her language and keeps the raw words small underneath', async () => {
  // Arrange
  const retry = jest.fn(async () => {});

  // Act
  await render(
    <RouteError
      error={new TypeError("Cannot read property 'uploaded_at' of undefined")}
      retry={retry}
    />,
  );

  // Assert
  expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.getByText("Cannot read property 'uploaded_at' of undefined")).toBeTruthy();
});

test('tries the screen again on tap', async () => {
  // Arrange
  const retry = jest.fn(async () => {});
  await render(<RouteError error={new Error('boom')} retry={retry} />);

  // Act
  fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

  // Assert
  expect(retry).toHaveBeenCalledTimes(1);
});

test('a thrown value that is not an Error still gets the screen, not a second crash', async () => {
  // Arrange / Act: JavaScript lets anything be thrown.
  await render(<RouteError error={'boom' as unknown as Error} retry={jest.fn(async () => {})} />);

  // Assert
  expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.getByText('boom')).toBeTruthy();
});

// Order matters below: the first draw is a one-way switch for the app's life.
test('the root lets an error through until the app has drawn once, so an OTA can roll back', async () => {
  // Arrange: React reports the uncaught error on the console; that is expected here.
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const error = new Error('broken first screen');

  // Act / Assert
  await expect(
    render(<RootRouteError error={error} retry={jest.fn(async () => {})} />),
  ).rejects.toThrow('broken first screen');
});

test('once the app has drawn, the root catches like any screen', async () => {
  // Arrange
  markAppDrawn();

  // Act
  await render(<RootRouteError error={new Error('later')} retry={jest.fn(async () => {})} />);

  // Assert
  expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
});

test('the root also offers to drop the saved lists, which a retry alone restores again', async () => {
  // Arrange: a list restored from disk that this build cannot draw comes back
  // on every retry, because the retry restores it again.
  markAppDrawn();
  const order: string[] = [];
  jest.mocked(forgetSavedQueries).mockImplementation(async () => {
    order.push('forget');
  });
  const retry = jest.fn(async () => {
    order.push('retry');
  });
  await render(<RootRouteError error={new Error('Cached tasks unreadable')} retry={retry} />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Сбросить сохранённые списки' }));

  // Assert: forgotten first, then drawn again from a fresh start.
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  expect(order).toEqual(['forget', 'retry']);
  expect(screen.getByText('Списки загрузятся заново. Действия, ждущие связи, сохранятся.')).toBeTruthy();
});

test('the root still draws again when the saved lists could not be dropped', async () => {
  // Arrange
  markAppDrawn();
  jest.mocked(forgetSavedQueries).mockRejectedValue(new Error('storage unavailable'));
  const retry = jest.fn(async () => {});
  await render(<RootRouteError error={new Error('boom')} retry={retry} />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Сбросить сохранённые списки' }));

  // Assert: the same as a retry — if the lists were the cause, the screen says so again.
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
});

test("a single screen offers only the retry: its saved lists are the whole app's", async () => {
  // Arrange / Act
  await render(<RouteError error={new Error('boom')} retry={jest.fn(async () => {})} />);

  // Assert
  expect(screen.queryByRole('button', { name: 'Сбросить сохранённые списки' })).toBeNull();
});

test('draws no empty detail line for an error without words', async () => {
  // Arrange / Act
  await render(<RouteError error={new Error('')} retry={jest.fn(async () => {})} />);

  // Assert: the sentence and the button, nothing else to read.
  expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.queryAllByText('')).toHaveLength(0);
});
