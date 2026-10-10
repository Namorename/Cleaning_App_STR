import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

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

/** The titles the screen gave its header, if any; the root layout names it otherwise. */
const mockTitles: unknown[] = [];
let mockParams: Record<string, string> = {};

/** The screen's place in the stack; going back tells the listeners first, as the router does. */
type Listener = () => void;
const mockNavigation = {
  listeners: new Map<string, Set<Listener>>(),
  setOptions: (options: { title?: string }) => mockTitles.push(options.title),
  isFocused: () => true,
  addListener: (event: string, listener: Listener) => {
    const listeners = mockNavigation.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    mockNavigation.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  },
};

jest.mock('expo-router', () => {
  const leave = () => mockNavigation.listeners.get('beforeRemove')?.forEach((fn) => fn());
  return {
    router: { back: jest.fn(leave), replace: jest.fn(leave) },
    useLocalSearchParams: () => mockParams,
    useNavigation: () => mockNavigation,
  };
});

const mockSession: { userId: string | null } = { userId: ME };

jest.mock('@/features/auth/session', () => ({
  useSession: () => mockSession,
}));

jest.mock('@/features/tasks/use-tasks', () => ({
  useTask: () => ({ data: undefined }),
}));

const mockMutate = jest.fn();
let mockCatalog: CatalogItem[] = [];
/** Whether the server has taken the request; a test turns it on. */
const mockSave = { isSuccess: false };

jest.mock('../use-supplies', () => ({
  useSupplyRequest: jest.fn(),
  useSupplyCatalog: () => ({ data: mockCatalog }),
  useSaveSupplyRequest: () => ({
    mutate: mockMutate,
    isPending: false,
    isPaused: false,
    isSuccess: mockSave.isSuccess,
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
  mockSession.userId = ME;
  mockCatalog = [];
  mockMutate.mockClear();
  mockSave.isSuccess = false;
  mockTitles.length = 0;
  mockNavigation.listeners.clear();
});

describe('a rewrite that cannot start from its request', () => {
  test('a request that could not load says why, and «Повторить» asks again', async () => {
    // Arrange
    const refetch = jest.fn();
    jest.mocked(useSupplyRequest).mockReturnValue({
      data: undefined,
      error: new Error('Network request failed'),
      refetch,
    } as unknown as ReturnType<typeof useSupplyRequest>);

    // Act
    await render(<SupplyFormRoute />);
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));

    // Assert: not a skeleton for ever.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test('a request that is not there says so', async () => {
    jest
      .mocked(useSupplyRequest)
      .mockReturnValue({ data: null } as unknown as ReturnType<typeof useSupplyRequest>);

    await render(<SupplyFormRoute />);

    expect(screen.getByText('Заявка не найдена')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  // Nobody to ask as: the query never runs, TanStack calls it pending for ever.
  test('before she is known, the request is not found, not loading for ever', async () => {
    mockSession.userId = null;
    answer(undefined);

    await render(<SupplyFormRoute />);

    expect(screen.getByText('Заявка не найдена')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

// The root layout titles the screen «Новая заявка»; a rewrite says what it is
// from the first frame, before the request has loaded.
test('a rewrite is titled «Изменить заявку», while it loads as well', async () => {
  // Arrange
  answer(undefined);

  // Act
  await render(<SupplyFormRoute />);

  // Assert: said as loading, by the label of the skeleton that stands in.
  expect(screen.getByRole('progressbar', { name: 'Загружаем заявки…' })).toBeTruthy();
  expect(mockTitles.at(-1)).toBe('Изменить заявку');
});

// A saved rewrite goes back by itself, and the answers that come in during
// the way back redraw the screen. On Android a header touched in the pop's
// moment brings the app down (Sentry, 2026-10-09 and 10-10): the title is set
// once, and not again once the screen is leaving.
test('a rewrite saved, back first: the redraws of the way back leave the header alone', async () => {
  // Arrange
  answer(request('Мешки'));
  const view = await render(<SupplyFormRoute />);
  expect(mockTitles).toEqual(['Изменить заявку']);

  // Act: the server takes it, the screen goes back, the request comes in again.
  mockSave.isSuccess = true;
  await view.rerender(<SupplyFormRoute />);
  expect(router.back).toHaveBeenCalledTimes(1);
  answer(request('Мешки для мусора'));
  await view.rerender(<SupplyFormRoute />);

  // Assert
  expect(mockTitles).toEqual(['Изменить заявку']);
});

test('a request that arrives after the screen opened fills the form', async () => {
  // Arrange: nothing yet.
  answer(undefined);
  const view = await render(<SupplyFormRoute />);
  expect(screen.getByRole('progressbar', { name: 'Загружаем заявки…' })).toBeTruthy();

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

test('a request already taken up is not hers to rewrite, and the screen says so', async () => {
  // Arrange
  jest.mocked(useSupplyRequest).mockReturnValue({
    data: { ...request('Мешки'), status: 'accepted' },
  } as ReturnType<typeof useSupplyRequest>);

  // Act
  await render(<SupplyFormRoute />);

  // Assert
  expect(screen.getByText('Заявку уже взяли в работу — изменить её нельзя')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
});
