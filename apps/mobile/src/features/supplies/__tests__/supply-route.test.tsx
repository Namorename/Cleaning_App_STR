import { fireEvent, render, screen } from '@testing-library/react-native';

import SupplyFormRoute from '@/app/supply/new';

import type { SupplyRequest } from '../schema';
import { useSupplyRequest } from '../use-supplies';

/**
 * Rewriting a request that is still new: the form starts from the row once,
 * then belongs to her fingers. Pinned here because the way it does so changed
 * (a state set during render instead of in an effect) and must not change
 * what she sees.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REQUEST_ID = 'e1f2a3b4-1111-4111-8111-e1f2a3b40001';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'f1a2b3c4-1111-4111-8111-f1a2b3c40001' }));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'e1f2a3b4-1111-4111-8111-e1f2a3b40001' }),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ data: undefined }),
}));

jest.mock('../use-supplies', () => ({
  useSupplyRequest: jest.fn(),
  useSupplyCatalog: () => ({ data: [] }),
  useSaveSupplyRequest: () => ({
    mutate: jest.fn(),
    isPending: false,
    isPaused: false,
    isSuccess: false,
    error: null,
  }),
}));

function request(itemName: string): SupplyRequest {
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
        name: itemName,
        quantity: 2,
        unit: 'pack',
        comment: null,
        catalog_item_id: null,
        sort_order: 1,
      },
    ],
  } as SupplyRequest;
}

function answer(data: SupplyRequest | undefined): void {
  jest.mocked(useSupplyRequest).mockReturnValue({ data } as ReturnType<typeof useSupplyRequest>);
}

test('a request that arrives after the screen opened fills the form', async () => {
  // Arrange: nothing yet.
  answer(undefined);
  const view = await render(<SupplyFormRoute />);
  expect(screen.getByText('Загружаем заявки…')).toBeTruthy();

  // Act: the row arrives.
  answer(request('Мешки'));
  await view.rerender(<SupplyFormRoute />);

  // Assert
  expect(screen.getByDisplayValue('Мешки')).toBeTruthy();
});

test('what she typed survives the request being fetched again under her', async () => {
  // Arrange
  answer(request('Мешки'));
  const view = await render(<SupplyFormRoute />);
  await fireEvent.changeText(screen.getByLabelText('Позиция 1: название'), 'Мешки 60 л');

  // Act: a refetch hands over a new copy of the row.
  answer(request('Мешки'));
  await view.rerender(<SupplyFormRoute />);

  // Assert
  expect(screen.getByDisplayValue('Мешки 60 л')).toBeTruthy();
});
