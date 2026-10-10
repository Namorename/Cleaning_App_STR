import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet, type ViewStyle } from 'react-native';

import { BUTTON_HEIGHT, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { ConfirmDialog } from '../confirm-dialog';

/**
 * A question asked before a move that cannot be taken back (owner, 2026-10-10):
 * the app's own buttons, 56 dp for a gloved finger, not the system's Alert —
 * whose buttons are small and whose look is neither theme's.
 */

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: jest.fn(() => 'light') }));

const scheme = jest.mocked(useColorScheme);

interface Handlers {
  onConfirm: jest.Mock;
  onCancel: jest.Mock;
}

async function renderDialog(isVisible = true): Promise<Handlers> {
  const handlers = { onConfirm: jest.fn(), onCancel: jest.fn() };
  await render(
    <ConfirmDialog
      isVisible={isVisible}
      title="Завершить уборку?"
      message="Nádražní 6 · Unit 3"
      confirmLabel="Завершить"
      {...handlers}
    />,
  );
  return handlers;
}

function styleOf(testID: string): ViewStyle {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as ViewStyle;
}

beforeEach(() => {
  scheme.mockReturnValue('light');
  jest.mocked(useReducedMotion).mockReturnValue(false);
});

test('closed: nothing is drawn', async () => {
  await renderDialog(false);

  expect(screen.queryByText('Завершить уборку?')).toBeNull();
});

test('open: the question is a header, the place one line under it, and two buttons', async () => {
  await renderDialog();

  expect(screen.getByRole('header', { name: 'Завершить уборку?' })).toBeTruthy();
  expect(screen.getByText('Nádražní 6 · Unit 3')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Завершить' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeTruthy();
});

test('both buttons are the app’s own, 56 dp high', async () => {
  await renderDialog();

  for (const name of ['Завершить', 'Отмена']) {
    const box = StyleSheet.flatten(screen.getByRole('button', { name }).props.style) as ViewStyle;
    expect(box.minHeight).toBe(BUTTON_HEIGHT);
  }
  expect(BUTTON_HEIGHT).toBe(56);
});

test('«Завершить» answers yes, once, however fast it is tapped twice', async () => {
  const { onConfirm, onCancel } = await renderDialog();

  const confirm = screen.getByRole('button', { name: 'Завершить' });
  await fireEvent.press(confirm);
  await fireEvent.press(confirm);

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

// Two taps in one frame: the second comes before the first answer is drawn,
// so the held buttons cannot stop it — the dialog's own memory of the answer does.
test('two taps in the same frame still answer once', async () => {
  const { onConfirm, onCancel } = await renderDialog();
  const confirm = screen.getByRole('button', { name: 'Завершить' });
  const cancel = screen.getByRole('button', { name: 'Отмена' });

  await act(async () => {
    fireEvent.press(confirm);
    fireEvent.press(confirm);
    fireEvent.press(cancel);
  });

  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onCancel).not.toHaveBeenCalled();
});

test('after a yes both buttons are held, so a tap on «Отмена» cannot follow it', async () => {
  const { onCancel } = await renderDialog();

  await fireEvent.press(screen.getByRole('button', { name: 'Завершить' }));

  expect(screen.getByRole('button', { name: 'Завершить' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Отмена' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));
  expect(onCancel).not.toHaveBeenCalled();
});

test('opened again, it answers again', async () => {
  const handlers = { onConfirm: jest.fn(), onCancel: jest.fn() };
  const props = { title: 'Завершить уборку?', confirmLabel: 'Завершить', ...handlers };
  const { rerender } = await render(<ConfirmDialog isVisible {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Завершить' }));

  await rerender(<ConfirmDialog isVisible={false} {...props} />);
  await rerender(<ConfirmDialog isVisible {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Завершить' }));

  expect(handlers.onConfirm).toHaveBeenCalledTimes(2);
});

test('«Отмена» answers no', async () => {
  const { onConfirm, onCancel } = await renderDialog();

  await fireEvent.press(screen.getByRole('button', { name: 'Отмена' }));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('the system’s back answers no', async () => {
  const { onConfirm, onCancel } = await renderDialog();

  await fireEvent(screen.getByTestId('confirm-dialog'), 'requestClose');

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('a tap on the darkened screen around it answers no, and is not a control for the reader', async () => {
  const { onConfirm, onCancel } = await renderDialog();

  // Hidden from the reader twice over: not important, and beside a card that
  // holds the reader (accessibilityViewIsModal hides its siblings).
  const backdrop = screen.getByTestId('confirm-dialog-backdrop', { includeHiddenElements: true });
  expect(backdrop.props.importantForAccessibility).toBe('no');
  await fireEvent.press(backdrop);

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('shown, the screen reader is taken to the question', async () => {
  const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  await renderDialog();

  await fireEvent(screen.getByTestId('confirm-dialog'), 'show');

  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
  send.mockRestore();
});

test('in the web preview, shown, it asks the reader for nothing it does not have', async () => {
  const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => {});
  jest.replaceProperty(Platform, 'OS', 'web');
  await renderDialog();

  await fireEvent(screen.getByTestId('confirm-dialog'), 'show');

  expect(send).not.toHaveBeenCalled();
  expect(screen.getByRole('header', { name: 'Завершить уборку?' })).toBeTruthy();
  jest.restoreAllMocks();
});

test('the card holds the reader inside it on iOS', async () => {
  await renderDialog();

  expect(screen.getByTestId('confirm-dialog-card').props.accessibilityViewIsModal).toBe(true);
});

test('fades in, or appears at once when the phone asks for less motion', async () => {
  await renderDialog();
  expect(screen.getByTestId('confirm-dialog').props.animationType).toBe('fade');

  jest.mocked(useReducedMotion).mockReturnValue(true);
  await renderDialog();
  expect(screen.getAllByTestId('confirm-dialog').at(-1)?.props.animationType).toBe('none');
});

test.each(['light', 'dark'] as const)(
  'in the %s theme the card is that theme’s card',
  async (name) => {
    scheme.mockReturnValue(name);
    await renderDialog();

    expect(styleOf('confirm-dialog-card').backgroundColor).toBe(Colors[name].card);
  },
);

test('no fixed height: large system text grows the card, and it scrolls past the screen', async () => {
  await renderDialog();

  expect(styleOf('confirm-dialog-card').height).toBeUndefined();
  expect(screen.getByTestId('confirm-dialog-scroll')).toBeTruthy();
});

test('a destructive yes is drawn as one: the urgent tone, never a solid red', async () => {
  await render(
    <ConfirmDialog
      isVisible
      title="Снять с работы?"
      confirmLabel="Снять"
      variant="destructive"
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />,
  );

  const yes = StyleSheet.flatten(
    screen.getByRole('button', { name: 'Снять' }).props.style,
  ) as ViewStyle;
  expect(yes.backgroundColor).toBe(Colors.light.tone.urgent.bg);
});
