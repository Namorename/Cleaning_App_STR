import { fireEvent, render, screen } from '@testing-library/react-native';

import SupplyFormRoute from '@/app/supply/new';

import type { CatalogItem, SupplyRequest } from '../schema';
import { useSupplyRequest } from '../use-supplies';

/**
 * The form's screen: a new request, or a rewrite of one that is still new.
 *
 * A rewrite starts from the row once, then belongs to her fingers — pinned
 * because the way it does so changed (a state set during render instead of in
 * an effect) and must not change what she sees. And what the screen sends is
 * pinned here as it was before the cart: `save_supply_request` with the
 * phone's id, the lines in the order she added them, the urgency and the note.
 */

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REQUEST_ID = 'e1f2a3b4-1111-4111-8111-e1f2a3b40001';
const MINTED_ID = 'f1a2b3c4-1111-4111-8111-f1a2b3c40001';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'f1a2b3c4-1111-4111-8111-f1a2b3c40001' }));

/** The title the screen gives itself, if any; the root layout names it otherwise. */
const mockTitles: unknown[] = [];
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      mockTitles.push(options?.title);
      return null;
    },
  },
  router: { back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ data: undefined }),
}));

const mockMutate = jest.fn();
let mockCatalog: CatalogItem[] = [];

jest.mock('../use-supplies', () => ({
  useSupplyRequest: jest.fn(),
  useSupplyCatalog: () => ({ data: mockCatalog }),
  useSaveSupplyRequest: () => ({
    mutate: mockMutate,
    isPending: false,
    isPaused: false,
    isSuccess: false,
    error: null,
  }),
}));

const bags: CatalogItem = {
  id: 'c9000002-0000-4000-8000-000000000002',
  name: 'Мешки для мусора',
  name_i18n: {},
  unit: 'pack',
  sort_order: 1,
};

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

beforeEach(() => {
  mockParams = { id: REQUEST_ID };
  mockCatalog = [];
  mockMutate.mockClear();
});

// The root layout titles the screen «Новая заявка»; a rewrite says what it is
// from the first frame, before the request has loaded.
test('a rewrite is titled «Изменить заявку», while it loads as well', async () => {
  // Arrange
  answer(undefined);

  // Act
  await render(<SupplyFormRoute />);

  // Assert
  expect(screen.getByText('Загружаем заявки…')).toBeTruthy();
  expect(mockTitles.at(-1)).toBe('Изменить заявку');
});

test('a request that arrives after the screen opened fills the form', async () => {
  // Arrange: nothing yet.
  answer(undefined);
  const view = await render(<SupplyFormRoute />);
  expect(screen.getByText('Загружаем заявки…')).toBeTruthy();

  // Act: the row arrives.
  answer(request('Мешки'));
  await view.rerender(<SupplyFormRoute />);

  // Assert: her own line, above the (empty) catalogue, with its quantity.
  expect(screen.getByText('Мешки')).toBeTruthy();
  expect(screen.getByLabelText('Мешки: количество').props.value).toBe('2');
});

test('what she typed survives the request being fetched again under her', async () => {
  // Arrange
  answer(request('Мешки'));
  const view = await render(<SupplyFormRoute />);
  await fireEvent.changeText(screen.getByLabelText('Мешки: количество'), '5');

  // Act: a refetch hands over a new copy of the row.
  answer(request('Мешки'));
  await view.rerender(<SupplyFormRoute />);

  // Assert
  expect(screen.getByLabelText('Мешки: количество').props.value).toBe('5');
});

test('a rewrite is saved under the request’s own id, its lines as the server takes them', async () => {
  // Arrange
  answer(request('Мешки'));
  await render(<SupplyFormRoute />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Мешки: на одну больше' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));

  // Assert
  expect(mockMutate).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    items: [{ name: 'Мешки', quantity: 3, unit: 'pack' }],
    priority: 'normal',
    note: '',
    taskId: null,
    propertyId: 412432,
  });
});

test('a new request goes under the id the phone made, picked lines with their entry', async () => {
  // Arrange
  mockParams = {};
  mockCatalog = [bags];
  answer(undefined);
  await render(<SupplyFormRoute />);

  // Act
  await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну больше' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Мешки для мусора: на одну больше' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Срочно' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить заявку' }));

  // Assert
  expect(mockMutate).toHaveBeenCalledWith({
    requestId: MINTED_ID,
    items: [{ name: 'Мешки для мусора', quantity: 2, unit: 'pack', catalog_item_id: bags.id }],
    priority: 'urgent',
    note: '',
    taskId: null,
    propertyId: null,
  });
});
