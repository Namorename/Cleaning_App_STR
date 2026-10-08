import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, StyleSheet, type AlertButton, type TextStyle } from 'react-native';

import SupplyRoute from '@/app/supply/[id]';
import { Colors, FontSize } from '@/constants/theme';

import type { SupplyRequest } from '../schema';

/**
 * One request, wired (app/supply/[id]). Who may do what is decided here: the
 * author changes or withdraws her request while it is new, and withdrawing
 * asks first — it cannot be undone. The screen's own states — loading, a
 * failure, a request that is not there — are this route's too.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SOMEONE_ELSE = '8d0f7780-8536-41ef-a55c-f18e2a01ab08';
const REQUEST_ID = 'b7c8d9e0-3333-4333-8333-b7c8d9e00001';
const GENERAL = 'Не удалось выполнить действие. Попробуйте ещё раз.';

const mockSession = { userId: ME as string | null };
let mockParams: Record<string, string> = { id: REQUEST_ID };
const mockRequestQuery: {
  isPending: boolean;
  error: Error | null;
  data: SupplyRequest | null | undefined;
} = { isPending: false, error: null, data: undefined };
const mockRemove = {
  mutate: jest.fn(),
  isPending: false,
  isPaused: false,
  isSuccess: false,
  error: null as Error | null,
};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/auth/session', () => ({ useSession: () => mockSession }));

jest.mock('@/features/supplies/use-supplies', () => ({
  useSupplyRequest: () => mockRequestQuery,
  useDeleteSupplyRequest: () => mockRemove,
}));

function request(overrides: Partial<SupplyRequest> = {}): SupplyRequest {
  return {
    id: REQUEST_ID,
    requested_by: ME,
    property_id: 412432,
    task_id: null,
    status: 'new',
    priority: 'normal',
    note: null,
    needed_by: null,
    reviewed_at: null,
    fulfilled_at: null,
    reject_reason: null,
    created_at: '2026-11-10T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    items: [
      {
        id: 'e1f2a3b4-2222-4222-8222-e1f2a3b40001',
        name: 'Мешки для мусора',
        quantity: 2,
        unit: 'pack',
        comment: null,
        catalog_item_id: null,
        sort_order: 1,
      },
    ],
    ...overrides,
  };
}

function styleOf(element: { props: { style?: unknown } }): TextStyle {
  return StyleSheet.flatten(element.props.style as TextStyle);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.userId = ME;
  mockParams = { id: REQUEST_ID };
  mockRequestQuery.isPending = false;
  mockRequestQuery.error = null;
  mockRequestQuery.data = request();
  mockRemove.isPending = false;
  mockRemove.isPaused = false;
  mockRemove.isSuccess = false;
  mockRemove.error = null;
});

describe('who may do what', () => {
  test('her new request: «Изменить» opens the form on it', async () => {
    await render(<SupplyRoute />);

    await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/supply/new',
      params: { id: REQUEST_ID },
    });
  });

  test('withdrawing asks first, and goes only once she confirms', async () => {
    // Arrange
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<SupplyRoute />);

    // Act
    await fireEvent.press(screen.getByRole('button', { name: 'Удалить заявку' }));

    // Assert: the question, nothing sent yet.
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
    expect(title).toBe('Удалить заявку');
    expect(message).toBe('Заявка исчезнет у менеджера. Удалить?');
    expect(buttons.map((button) => [button.text, button.style])).toEqual([
      ['Отмена', 'cancel'],
      ['Удалить заявку', 'destructive'],
    ]);
    expect(mockRemove.mutate).not.toHaveBeenCalled();

    // Act: she confirms.
    buttons[1].onPress?.();

    // Assert
    expect(mockRemove.mutate).toHaveBeenCalledWith(REQUEST_ID);
  });

  test.each(['accepted', 'ordered', 'fulfilled', 'rejected'] as const)(
    'her request once %s is no longer hers to change',
    async (status) => {
      mockRequestQuery.data = request({ status });

      await render(<SupplyRoute />);

      expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Удалить заявку' })).toBeNull();
    },
  );

  test('somebody else’s new request is read only', async () => {
    mockRequestQuery.data = request({ requested_by: SOMEONE_ELSE });

    await render(<SupplyRoute />);

    expect(screen.getByText('Мешки для мусора')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a withdrawal on its way holds both moves', async () => {
    mockRemove.isPending = true;

    await render(<SupplyRoute />);

    expect(
      screen.getByRole('button', { name: 'Удалить заявку' }).props.accessibilityState,
    ).toMatchObject({ disabled: true, busy: true });
  });

  test('a withdrawal that is done, or queued for the signal, leaves the screen', async () => {
    mockRemove.isPaused = true;

    await render(<SupplyRoute />);

    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test('a failed withdrawal is said on the screen, in her language', async () => {
    mockRemove.error = new Error('Network request failed');

    await render(<SupplyRoute />);

    expect(screen.getByText(GENERAL)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });
});

describe('the screen’s own states', () => {
  test('a broken link is a request that is not there', async () => {
    mockParams = { id: 'not-a-uuid' };

    await render(<SupplyRoute />);

    expect(screen.getByText('Заявка не найдена')).toBeTruthy();
  });

  test('a request that is not there says so', async () => {
    mockRequestQuery.data = null;

    await render(<SupplyRoute />);

    expect(screen.getByText('Заявка не найдена')).toBeTruthy();
  });

  test('while it loads nothing of it is shown, and nothing can be done', async () => {
    mockRequestQuery.isPending = true;
    mockRequestQuery.data = undefined;

    await render(<SupplyRoute />);

    expect(screen.queryByText('Мешки для мусора')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('a request that could not load says why, the raw words under it', async () => {
    mockRequestQuery.error = new Error('Network request failed');
    mockRequestQuery.data = undefined;

    await render(<SupplyRoute />);

    expect(screen.getByText(GENERAL)).toBeTruthy();
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });
});

describe('on the «Абрикос» components', () => {
  test('while it loads, its shape stands in for it, said as loading', async () => {
    mockRequestQuery.isPending = true;
    mockRequestQuery.data = undefined;

    await render(<SupplyRoute />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем заявки…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('a request that could not load is the error state: the sentence as an alert', async () => {
    mockRequestQuery.error = new Error('Network request failed');
    mockRequestQuery.data = undefined;

    await render(<SupplyRoute />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(styleOf(screen.getByText('Network request failed')).fontSize).toBe(FontSize.caption);
  });

  test('«Заявка не найдена» is the secondary body', async () => {
    mockRequestQuery.data = null;

    await render(<SupplyRoute />);

    const message = styleOf(screen.getByText('Заявка не найдена'));
    expect(message.color).toBe(Colors.light.textSecondary);
    expect(message.fontSize).toBe(FontSize.body);
  });
});
