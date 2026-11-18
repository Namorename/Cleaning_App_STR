import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { setWordContext } from '@/testing/word-context';

import { HandBackSheet } from '../hand-back-sheet';
import type { CleaningOffKind } from '../offs';

/**
 * The question before a cleaning is taken off (20261118120000): what follows
 * from it, a reason — required for an interrupt, as the server requires it —
 * and the answer. The app's own sheet; a refusal stays on it, in her words.
 */

const onConfirm = jest.fn();
const onClose = jest.fn();

interface Drawn {
  kind: CleaningOffKind;
  isBusy?: boolean;
  error?: Error | null;
}

async function draw({ kind, isBusy = false, error = null }: Drawn): Promise<void> {
  await render(
    <HandBackSheet
      kind={kind}
      isBusy={isBusy}
      error={error}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
}

function sheet() {
  return within(screen.getByTestId('hand-back-sheet'));
}

function confirmButton(name: string) {
  return sheet().getByRole('button', { name });
}

async function type(label: string, text: string): Promise<void> {
  await fireEvent.changeText(sheet().getByLabelText(label), text);
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await setWordContext(undefined);
});

describe('a decline', () => {
  test('asks, says what follows, and leaves the reason to her', async () => {
    await draw({ kind: 'decline' });

    expect(sheet().getByRole('header', { name: 'Отказаться от уборки?' })).toBeTruthy();
    expect(sheet().getByText('Менеджер узнает об отказе и найдёт замену.')).toBeTruthy();
    expect(sheet().getByLabelText('Причина (необязательно)')).toBeTruthy();
    expect(confirmButton('Отказаться').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  test('without a reason, sends none', async () => {
    await draw({ kind: 'decline' });

    await fireEvent.press(confirmButton('Отказаться'));

    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  test('sends her reason trimmed', async () => {
    await draw({ kind: 'decline' });

    await type('Причина (необязательно)', '  Заболела \n');
    await fireEvent.press(confirmButton('Отказаться'));

    expect(onConfirm).toHaveBeenCalledWith('Заболела');
  });

  test('a technician declines work, not a cleaning', async () => {
    await setWordContext('tech');

    await draw({ kind: 'decline' });

    expect(sheet().getByRole('header', { name: 'Отказаться от работы?' })).toBeTruthy();
    expect(sheet().queryByText(/уборк/i)).toBeNull();
  });
});

describe('an interrupt', () => {
  test('asks, says the steps and photos stay, and requires a reason', async () => {
    await draw({ kind: 'interrupt' });

    expect(sheet().getByRole('header', { name: 'Прервать уборку?' })).toBeTruthy();
    expect(
      sheet().getByText('Сделанные шаги и фото сохранятся: закончит другой человек.'),
    ).toBeTruthy();
    expect(sheet().getByLabelText('Причина')).toBeTruthy();
  });

  test('cannot be confirmed without a reason, nor with a blank one', async () => {
    await draw({ kind: 'interrupt' });

    expect(confirmButton('Прервать').props.accessibilityState).toMatchObject({ disabled: true });
    await type('Причина', '   ');
    await fireEvent.press(confirmButton('Прервать'));

    expect(confirmButton('Прервать').props.accessibilityState).toMatchObject({ disabled: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('with a reason, is confirmed with it trimmed', async () => {
    await draw({ kind: 'interrupt' });

    await type('Причина', ' Нет воды в квартире ');

    expect(confirmButton('Прервать').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.press(confirmButton('Прервать'));
    expect(onConfirm).toHaveBeenCalledWith('Нет воды в квартире');
  });

  test('a technician interrupts work', async () => {
    await setWordContext('tech');

    await draw({ kind: 'interrupt' });

    expect(sheet().getByRole('header', { name: 'Прервать работу?' })).toBeTruthy();
  });
});

describe('a cancel', () => {
  test('asks the office, with an optional reason, and «Да, отменить»', async () => {
    await draw({ kind: 'cancel' });

    expect(sheet().getByRole('header', { name: 'Отменить уборку?' })).toBeTruthy();
    expect(
      sheet().getByText('Она пропадёт из списков и у исполнителя; шаги и фото останутся.'),
    ).toBeTruthy();
    expect(sheet().getByLabelText('Причина (необязательно)')).toBeTruthy();

    await fireEvent.press(confirmButton('Да, отменить'));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });
});

test('the reason is held to the 500 characters the server keeps, and counted', async () => {
  await draw({ kind: 'decline' });

  expect(sheet().getByLabelText('Причина (необязательно)').props.maxLength).toBe(500);
  await type('Причина (необязательно)', 'Заболела');
  expect(sheet().getByText('8 / 500')).toBeTruthy();
});

test('«Нет» closes the sheet and sends nothing', async () => {
  await draw({ kind: 'decline' });

  await fireEvent.press(confirmButton('Нет'));

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('while the answer is on its way, «yes» spins and a second tap sends nothing', async () => {
  await draw({ kind: 'decline', isBusy: true });

  await fireEvent.press(confirmButton('Отказаться'));

  expect(confirmButton('Отказаться').props.accessibilityState).toMatchObject({ busy: true });
  expect(onConfirm).not.toHaveBeenCalled();
});

test('a refusal is said on the sheet, in her words', async () => {
  const changed = Object.assign(new Error('refused'), {
    hint: 'serverErrors.taskChangedMeanwhile',
  });

  await draw({ kind: 'decline', error: changed });

  expect(sheet().getByText('Это уже изменилось — экран обновлён')).toBeTruthy();
});

test('a failure it cannot translate is said generally, the server’s words small under it', async () => {
  await draw({ kind: 'interrupt', error: new Error('Network request failed') });

  expect(sheet().getByText('Не удалось выполнить действие. Попробуйте ещё раз.')).toBeTruthy();
  expect(sheet().getByText('Network request failed')).toBeTruthy();
});
