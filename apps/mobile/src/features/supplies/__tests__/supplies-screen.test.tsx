import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import SuppliesScreen from '@/app/(tabs)/supplies';
import { BUTTON_HEIGHT, Colors, FontSize } from '@/constants/theme';

import type { SupplyRequest } from '../schema';
import { useMySupplyRequests } from '../use-supplies';

/**
 * Her requests, wired (the «Расходники» tab). «Запросить расходники» opens
 * «Новая заявка» above her requests, as it always did; an empty list says
 * so and offers the same move.
 */

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

jest.mock('../use-supplies', () => ({ useMySupplyRequests: jest.fn() }));

const REQUEST = 'Запросить расходники';
const REQUEST_ID = 'b7c8d9e0-3333-4333-8333-b7c8d9e00001';

function request(overrides: Partial<SupplyRequest> = {}): SupplyRequest {
  return {
    id: REQUEST_ID,
    requested_by: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
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

type ListAnswer = ReturnType<typeof useMySupplyRequests>;

function answer(overrides: Partial<ListAnswer>): void {
  jest.mocked(useMySupplyRequests).mockReturnValue({
    data: [request()],
    isPending: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
    ...overrides,
  } as ListAnswer);
}

function styleOf(element: { props: { style?: unknown } }): ViewStyle & TextStyle {
  return StyleSheet.flatten(element.props.style as ViewStyle) as ViewStyle & TextStyle;
}

beforeEach(() => {
  jest.clearAllMocks();
  answer({});
});

describe('today’s tab', () => {
  test('«Запросить расходники» opens «Новая заявка»', async () => {
    await render(<SuppliesScreen />);

    await fireEvent.press(screen.getByRole('button', { name: REQUEST }));

    expect(router.push).toHaveBeenCalledWith('/supply/new');
  });

  test('a card opens its request', async () => {
    await render(<SuppliesScreen />);

    await fireEvent.press(screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ }));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/supply/[id]',
      params: { id: REQUEST_ID },
    });
  });

  test('closed requests stand under their own heading', async () => {
    answer({
      data: [
        request(),
        request({ id: 'b7c8d9e0-3333-4333-8333-b7c8d9e00002', status: 'fulfilled' }),
      ],
    });

    await render(<SuppliesScreen />);

    expect(screen.getByText('Закрытые')).toBeTruthy();
    expect(screen.getByText('Выполнена')).toBeTruthy();
  });

  test('an empty list says so, and she can still start a request', async () => {
    answer({ data: [] });

    await render(<SuppliesScreen />);

    expect(screen.getByText('Заявок нет')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: REQUEST }));
    expect(router.push).toHaveBeenCalledWith('/supply/new');
  });

  test('a list that never loaded offers a retry, and the retry asks again', async () => {
    const refetch = jest.fn();
    answer({ data: undefined, error: new Error('Network request failed'), refetch });

    await render(<SuppliesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test('while the list loads no card is shown', async () => {
    answer({ data: undefined, isPending: true });

    await render(<SuppliesScreen />);

    expect(screen.queryByText('Мешки для мусора × 2 упак')).toBeNull();
  });
});

describe('on the «Абрикос» components', () => {
  test('«Запросить расходники» is the 56 dp main button', async () => {
    await render(<SuppliesScreen />);

    const button = styleOf(screen.getByRole('button', { name: REQUEST }));
    expect(button.minHeight).toBe(BUTTON_HEIGHT);
    expect(button.backgroundColor).toBe(Colors.light.cta);
  });

  test('while the list loads, its shape stands in for it, said as loading', async () => {
    answer({ data: undefined, isPending: true });

    await render(<SuppliesScreen />);

    const loading = screen.getByRole('progressbar', { name: 'Загружаем заявки…' });
    expect(loading.props.accessibilityState).toMatchObject({ busy: true });
  });

  test('an empty list is the empty state, titled, with the one way to a request', async () => {
    answer({ data: [] });

    await render(<SuppliesScreen />);

    expect(styleOf(screen.getByText('Заявок нет')).fontSize).toBe(FontSize.title);
    expect(screen.getAllByRole('button', { name: REQUEST })).toHaveLength(1);
  });

  test('closed requests stand under their heading, drawn as a caption', async () => {
    answer({
      data: [
        request(),
        request({ id: 'b7c8d9e0-3333-4333-8333-b7c8d9e00002', status: 'fulfilled' }),
      ],
    });

    await render(<SuppliesScreen />);

    const heading = styleOf(screen.getByText('Закрытые'));
    expect(heading.fontSize).toBe(FontSize.caption);
    expect(heading.color).toBe(Colors.light.textSecondary);
  });
});
