import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { BottomSheet } from '../bottom-sheet';

/**
 * A sheet from the bottom on React Native's own Modal — no native dependency,
 * so it ships over the air. Closed by «Закрыть», by the system's back, or by a
 * tap on the darkened screen around it.
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));

test('closed: nothing is drawn', async () => {
  await render(
    <BottomSheet isVisible={false} title="Объект" onClose={jest.fn()}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );

  expect(screen.queryByText('Nádražní 6')).toBeNull();
});

test('open: its title is a header, and its content is there', async () => {
  await render(
    <BottomSheet isVisible title="Объект" onClose={jest.fn()}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );

  expect(screen.getByRole('header', { name: 'Объект' })).toBeTruthy();
  expect(screen.getByText('Nádražní 6')).toBeTruthy();
});

test('«Закрыть» closes it', async () => {
  const onClose = jest.fn();
  await render(
    <BottomSheet isVisible title="Объект" onClose={onClose}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Закрыть' }));

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('the system back closes it too', async () => {
  const onClose = jest.fn();
  await render(
    <BottomSheet testID="sheet" isVisible title="Объект" onClose={onClose}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );

  await act(async () => screen.getByTestId('sheet').props.onRequestClose());

  expect(onClose).toHaveBeenCalledTimes(1);
});

test('fades in, unless the phone asks for less motion', async () => {
  const { rerender } = await render(
    <BottomSheet testID="sheet" isVisible title="Объект" onClose={jest.fn()}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );
  expect(screen.getByTestId('sheet').props.animationType).toBe('fade');

  jest.mocked(useReducedMotion).mockReturnValue(true);
  await rerender(
    <BottomSheet testID="sheet" isVisible title="Объект" onClose={jest.fn()}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );

  expect(screen.getByTestId('sheet').props.animationType).toBe('none');
});
