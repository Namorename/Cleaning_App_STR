import { fireEvent, render, screen } from '@testing-library/react-native';

import { groupSupplyRequests, type SupplyRequest } from '../schema';
import { SupplyList } from '../supply-list';

/**
 * Her requests as a list. «Запросить расходники» stands above the cards
 * whenever the list offers the move — under the line that says a refresh
 * failed, too — and a list given no such move draws none, not even in its
 * empty state.
 */

const REQUEST = 'Запросить расходники';
const REFRESH_FAILED = 'Не удалось обновить, показано сохранённое. Потяните вниз, чтобы повторить.';

function request(): SupplyRequest {
  return {
    id: 'b7c8d9e0-3333-4333-8333-b7c8d9e00001',
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
  };
}

const base = {
  isLoading: false,
  onRefresh: jest.fn(),
  isRefreshing: false,
  onPress: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('a refresh that failed keeps the cards, the line above them and the button', async () => {
  // Arrange
  const onRequest = jest.fn();

  // Act
  await render(
    <SupplyList
      {...base}
      sections={groupSupplyRequests([request()])}
      error={new Error('Network request failed')}
      onRequest={onRequest}
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: REQUEST }));

  // Assert
  expect(screen.getByText(REFRESH_FAILED)).toBeTruthy();
  expect(screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ })).toBeTruthy();
  expect(onRequest).toHaveBeenCalledTimes(1);
});

test('a list given no way to a new request draws no such button', async () => {
  await render(<SupplyList {...base} sections={groupSupplyRequests([request()])} error={null} />);

  expect(screen.queryByRole('button', { name: REQUEST })).toBeNull();
  expect(screen.getByRole('button', { name: /^CZ - Nadrazni Apt 6\./ })).toBeTruthy();
});

test('nor does its empty state', async () => {
  await render(<SupplyList {...base} sections={[]} error={null} />);

  expect(screen.getByText('Заявок нет')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});
