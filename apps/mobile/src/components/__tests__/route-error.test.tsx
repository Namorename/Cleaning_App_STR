import { fireEvent, render, screen } from '@testing-library/react-native';

import { RootRouteError, RouteError, markAppDrawn } from '../route-error';

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

test('draws no empty detail line for an error without words', async () => {
  // Arrange / Act
  await render(<RouteError error={new Error('')} retry={jest.fn(async () => {})} />);

  // Assert: the sentence and the button, nothing else to read.
  expect(screen.getByText('Не удалось показать экран. Попробуйте ещё раз.')).toBeTruthy();
  expect(screen.queryAllByText('')).toHaveLength(0);
});
