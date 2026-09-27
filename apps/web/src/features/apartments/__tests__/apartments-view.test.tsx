import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { propertySchema, type Property } from '../schema';

const property = (overrides: Record<string, unknown>): Property =>
  propertySchema.parse({
    name: 'Somewhere',
    address: null,
    city: 'Praha',
    status: 'active',
    parent_id: null,
    bedrooms: 1,
    max_guests: 2,
    ...overrides,
  });

const working = property({ id: 101, name: 'Vinohrady 12', address: 'Korunní 12' });
const repaired = property({ id: 102, name: 'Anděl 4', status: 'maintenance' });
const gone = property({ id: 103, name: 'Karlín 7', status: 'archived' });
const unit = property({ id: 104, name: 'Room A', parent_id: 101 });
// A multi-unit listing and two of its rooms: `hostaway_unit_id` is what makes
// a room a room rather than a part of a villa.
const house = property({ id: 201, name: 'Royal Cerna' });
const room10 = property({ id: 203, name: 'Unit 10', parent_id: 201, hostaway_unit_id: 7010 });
const room3 = property({ id: 202, name: 'Unit 3', parent_id: 201, hostaway_unit_id: 7003 });

/**
 * Two cleanings stand on Vinohrady 12 and none anywhere else.
 *
 * One row per listing carrying its total, not one row per task: the server
 * counts them now and folds a room's cleanings into the listing it belongs to
 * (`open_cleanings_by_listing`). The row shape is what the RPC returns.
 */
const openCleanings = [{ property_id: 101, cleanings: 2 }];

const setStatus = vi.fn();
const sync = vi.fn();
const syncState = {
  data: undefined as unknown,
  isPending: false,
  isError: false,
  error: null as unknown,
};
const countOpenCleanings = vi.fn();
// A query whose refetch failed keeps its data: `hasData` with `isError` is that case.
const registryState = { isError: false, hasData: true };

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('../api', () => ({
  countOpenCleanings: (...args: unknown[]) => countOpenCleanings(...args),
}));

vi.mock('../use-apartments', () => ({
  useRegistry: () => ({
    data: registryState.hasData ? [working, repaired, gone, unit, house, room10, room3] : undefined,
    isPending: false,
    isError: registryState.isError,
  }),
  useOpenCleanings: () => ({ data: openCleanings, isPending: false, isError: false }),
  useSetStatus: () => ({ isPending: false, mutateAsync: setStatus }),
  useSyncListings: () => ({ ...syncState, mutate: sync }),
}));

import { ApartmentsView } from '../apartments-view';

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApartmentsView />
    </QueryClientProvider>,
  );
}

const rowFor = (name: string): HTMLElement =>
  screen.getAllByRole('row').find((row) => row.textContent?.includes(name)) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  syncState.data = undefined;
  syncState.isError = false;
  syncState.error = null;
  registryState.isError = false;
  registryState.hasData = true;
  setStatus.mockResolvedValue(undefined);
  countOpenCleanings.mockResolvedValue(2);
});

describe('a refresh that fails keeps what is already on screen', () => {
  test('the listings stay when a refresh fails over data already shown', () => {
    registryState.isError = true;

    renderView();

    expect(screen.getByText('Vinohrady 12')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить объекты.')).not.toBeInTheDocument();
  });

  test('a first load that fails still says so', () => {
    registryState.isError = true;
    registryState.hasData = false;

    renderView();

    expect(screen.getByText('Не удалось загрузить объекты.')).toBeInTheDocument();
  });
});

describe('the registry opens on the listings that work', () => {
  test('an archived listing is not in the default view', () => {
    renderView();

    expect(screen.getByText('Vinohrady 12')).toBeInTheDocument();
    expect(screen.queryByText('Karlín 7')).not.toBeInTheDocument();
  });

  test('and neither is one under repair — that is its own tab', () => {
    renderView();

    expect(screen.queryByText('Anděl 4')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Работают/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Обслуживание/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Архив/ })).toHaveTextContent('1');
  });

  test('the archive tab is the one place an archived listing appears', async () => {
    renderView();

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));

    expect(screen.getByText('Karlín 7')).toBeInTheDocument();
    expect(screen.queryByText('Vinohrady 12')).not.toBeInTheDocument();
  });
});

describe('search', () => {
  test('finds a listing by a word of its address', async () => {
    renderView();

    await userEvent.type(screen.getByLabelText(/Поиск/), 'korunní');

    expect(screen.getByText('Vinohrady 12')).toBeInTheDocument();
    expect(screen.queryByText('Room A')).not.toBeInTheDocument();
  });

  test('searching does not drag the archive into the working tab', async () => {
    renderView();

    await userEvent.type(screen.getByLabelText(/Поиск/), 'karlín');

    // It is found — the count on the archive tab says so — but the tab being
    // read is still the working one, and it stays empty.
    expect(screen.getByRole('tab', { name: /Архив/ })).toHaveTextContent('1');
    expect(screen.queryByText('Karlín 7')).not.toBeInTheDocument();
    expect(screen.getByText('Ничего не найдено.')).toBeInTheDocument();
  });
});

describe('linked listings', () => {
  test('a unit says which listing it is part of', () => {
    renderView();

    expect(within(rowFor('Room A')).getByText(/Юнит объекта/)).toBeInTheDocument();
  });

  test('and a combined listing says how many units it has', () => {
    renderView();

    expect(within(rowFor('Vinohrady 12')).getByText(/Состоит из юнитов/)).toBeInTheDocument();
  });

  // The column is the half of the pair a manager reads first. The other half
  // is the number in the confirmation dialog, which asks the server fresh; the
  // two disagreed on this screen until the fold moved onto the server, so the
  // count is asserted here rather than left to the dialog's test.
  test('the cleanings column shows the number the server counted', () => {
    renderView();

    expect(within(rowFor('Vinohrady 12')).getByText('2')).toBeInTheDocument();
    // A listing the server did not mention reads zero, not blank.
    expect(within(rowFor('Room A')).getByText('0')).toBeInTheDocument();
  });
});

describe('taking a listing out of service', () => {
  test('the confirmation names the cleanings it would cancel', async () => {
    renderView();

    await userEvent.click(within(rowFor('Vinohrady 12')).getByRole('button', { name: 'В архив' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Убрать в архив?')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByText('Будет отменено запланированных уборок: 2.'),
      ).toBeInTheDocument(),
    );
    // And says plainly what survives it.
    expect(within(dialog).getByText(/Выполненные уборки, замеры времени, фото/)).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();
  }, 20000);

  test('nothing happens until it is confirmed', async () => {
    renderView();

    await userEvent.click(within(rowFor('Vinohrady 12')).getByRole('button', { name: 'В архив' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(setStatus).not.toHaveBeenCalled();
  }, 20000);

  test('confirming archives it and agrees to the sweep', async () => {
    renderView();

    await userEvent.click(within(rowFor('Vinohrady 12')).getByRole('button', { name: 'В архив' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Убрать в архив' }));

    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({
        propertyId: 101,
        status: 'archived',
        cancelTasks: true,
      }),
    );
  }, 20000);

  test('a listing with nothing booked is not warned about cancellations', async () => {
    countOpenCleanings.mockResolvedValue(0);
    renderView();

    await userEvent.click(screen.getByRole('tab', { name: /Обслуживание/ }));
    await userEvent.click(within(rowFor('Anděl 4')).getByRole('button', { name: 'В архив' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).queryByText(/Будет отменено/)).not.toBeInTheDocument());
  }, 20000);
});

describe('bringing one back', () => {
  test('the archive tab offers exactly one move, and it restores', async () => {
    renderView();

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    const row = rowFor('Karlín 7');

    expect(within(row).queryByRole('button', { name: 'В архив' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Вернуть в работу' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Новые уборки начнут создаваться/)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith({
        propertyId: 103,
        status: 'active',
        cancelTasks: true,
      }),
    );
  }, 20000);
});

describe('bulk actions', () => {
  test('several listings are ticked and moved by one press', async () => {
    renderView();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Vinohrady 12' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Room A' }));
    expect(screen.getByText('Выбрано: 2')).toBeInTheDocument();

    const bulk = screen.getByRole('group', { name: 'Действия над выбранными' });
    await userEvent.click(within(bulk).getByRole('button', { name: 'На обслуживание' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledTimes(2));
    expect(setStatus).toHaveBeenCalledWith({
      propertyId: 101,
      status: 'maintenance',
      cancelTasks: true,
    });
  }, 20000);
});

describe('the sync button', () => {
  test('reports what it added and what it updated', () => {
    syncState.data = {
      fetched: 12,
      normalized: 12,
      skipped: [],
      propertiesInserted: 2,
      propertiesUpdated: 10,
      durationMs: 800,
    };
    renderView();

    expect(screen.getByText('Готово. Добавлено: 2, обновлено: 10.')).toBeInTheDocument();
    expect(screen.getByText('Пропусков нет.')).toBeInTheDocument();
  });

  test('and does not hide a listing it could not read', () => {
    syncState.data = {
      fetched: 12,
      normalized: 11,
      skipped: [{ position: 4, reason: 'name is missing' }],
      propertiesInserted: 0,
      propertiesUpdated: 11,
      durationMs: 800,
    };
    renderView();

    expect(screen.getByText(/Пропущено объектов: 1/)).toBeInTheDocument();
    expect(screen.getByText(/name is missing/)).toBeInTheDocument();
  });

  test('pressing it starts a run', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: 'Синхронизировать с Hostaway' }));

    expect(sync).toHaveBeenCalled();
  });
});

/**
 * Rooms as a branch under their listing (docs/f10-plan.md, 7.1).
 */
describe('rooms under their listing', () => {
  const names = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('link')[0]?.textContent);

  test('come right after it, counted the way a person counts', () => {
    renderView();

    const order = names();
    const at = order.indexOf('Royal Cerna');
    expect(order.slice(at, at + 3)).toEqual(['Royal Cerna', 'Unit 3', 'Unit 10']);
  });

  // Trap 6: a room's state is changed by its own row button, whose dialog asks
  // the server for that one room; a bulk action would take the number from the
  // listing fold, which has no key for a room, and say "0".
  test('a room has no tick for a bulk action', () => {
    renderView();

    expect(within(rowFor('Unit 3')).queryByRole('checkbox')).toBeNull();
    expect(within(rowFor('Royal Cerna')).getByRole('checkbox')).toBeInTheDocument();
  });

  // Trap 4: the listing's number already includes its rooms.
  test('a room shows no cleanings of its own — they are counted on the listing', () => {
    renderView();

    const cell = within(rowFor('Unit 3')).getByTitle('Считается у объекта');
    expect(cell).toHaveTextContent('—');
  });

  test('the group closes and opens again', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: 'Скрыть единицы «Royal Cerna»' }));
    expect(screen.queryByText('Unit 3')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Показать единицы «Royal Cerna»' }));
    expect(screen.getByText('Unit 3')).toBeInTheDocument();
  });

  test('a tab counts listings, not the rooms inside them', () => {
    renderView();

    // Vinohrady 12 with its part, and Royal Cerna with its two rooms.
    expect(screen.getByRole('tab', { name: /Работают/ })).toHaveTextContent('(2)');
  });
});
