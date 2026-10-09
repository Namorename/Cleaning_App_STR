import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { BottomSheet } from '../bottom-sheet';

/**
 * A sheet from the bottom on React Native's own Modal — no native dependency,
 * so it ships over the air. Closed by «Закрыть», by the system's back, or by a
 * tap on the darkened screen around it.
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));

/**
 * The keyboard is native, so what is checked is what the sheet asks of React
 * Native's KeyboardAvoidingView: the props it was drawn with are recorded, and
 * what it holds is drawn inside a view the test can find.
 */
const mockAvoidingProps: { behavior?: string }[] = [];

jest.mock('react-native/Libraries/Components/Keyboard/KeyboardAvoidingView', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  function MockKeyboardAvoidingView(props: { behavior?: string; children?: unknown }) {
    mockAvoidingProps.push(props);
    return createElement(View, { testID: 'keyboard-avoiding' }, props.children);
  }
  return { __esModule: true, default: MockKeyboardAvoidingView };
});

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

// The review of 05.10: a search in the sheet raised the keyboard over its rows
// — the Modal draws edge to edge and the system does not shrink it. The sheet
// rises with the keyboard, its content inside the part that moves.
test('rises with the keyboard, so what is typed into it never hides its rows', async () => {
  await render(
    <BottomSheet isVisible title="Объект" onClose={jest.fn()}>
      <Text>Nádražní 6</Text>
    </BottomSheet>,
  );

  expect(mockAvoidingProps.at(-1)?.behavior).toBe('padding');
  expect(within(screen.getByTestId('keyboard-avoiding')).getByText('Nádražní 6')).toBeTruthy();
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
