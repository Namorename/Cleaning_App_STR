import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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

// The router reads the address jsdom holds; the view writes it through
// history, which jsdom keeps as a browser would. «Назад» moves it a task later
// with `popstate`, and the router shows the page again — as Next does.
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
  };
});

// The card has its own tests (property-card.test); here it only has to be
// opened beside the registry, with the tab the address names.
vi.mock('../property-card', () => ({
  PropertyCard: ({
    propertyId,
    tab,
    onTabChange,
  }: {
    propertyId: number;
    tab: string;
    onTabChange: (tab: string) => void;
  }) => (
    <section aria-label="Карточка объекта">
      <span>
        {propertyId}:{tab}
      </span>
      <button type="button" onClick={() => onTabChange('bookings')}>
        К бронированиям
      </button>
    </section>
  ),
}));

import { expectPageTitle } from '@/components/page-header.expect';

import { ApartmentsView } from '../apartments-view';

/** The query of the page's address, without its `?`. */
const query = () => window.location.search.slice(1);

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

const card = () => screen.queryByRole('region', { name: 'Карточка объекта' });

/** A row's moves wait in its menu «⋯» (5.4: they were two look-alike buttons). */
async function moveFromMenu(name: string, move: string): Promise<void> {
  await userEvent.click(within(rowFor(name)).getByRole('button', { name: `Действия: ${name}` }));
  const menu = await screen.findByRole('menu');
  await userEvent.click(within(menu).getByRole('menuitem', { name: move }));
}

const menuOf = async (name: string): Promise<string[]> => {
  await userEvent.click(within(rowFor(name)).getByRole('button', { name: `Действия: ${name}` }));
  const menu = await screen.findByRole('menu');
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
};

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
  window.history.replaceState(null, '', '/apartments');
  syncState.data = undefined;
  syncState.isError = false;
  syncState.error = null;
  registryState.isError = false;
  registryState.hasData = true;
  setStatus.mockResolvedValue(undefined);
  countOpenCleanings.mockResolvedValue(2);
});

describe('the page', () => {
  test('is headed by the common header, the sync among its actions', () => {
    renderView();

    expectPageTitle('Объекты');
    expect(
      screen.getByRole('heading', { level: 1 }).closest('[data-slot="page-header"]'),
    ).toContainElement(screen.getByRole('button', { name: /Hostaway/ }));
  });
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

    await moveFromMenu('Vinohrady 12', 'В архив');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Убрать в архив?')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(dialog).getByText('Будет отменено запланированных уборок: 2.'),
      ).toBeInTheDocument(),
    );
    // And says plainly what survives it.
    expect(
      within(dialog).getByText(/Выполненные уборки, замеры времени, фото/),
    ).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();
  }, 20000);

  test('nothing happens until it is confirmed', async () => {
    renderView();

    await moveFromMenu('Vinohrady 12', 'В архив');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(setStatus).not.toHaveBeenCalled();
  }, 20000);

  test('confirming archives it and agrees to the sweep', async () => {
    renderView();

    await moveFromMenu('Vinohrady 12', 'В архив');
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
    await moveFromMenu('Anděl 4', 'В архив');

    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).queryByText(/Будет отменено/)).not.toBeInTheDocument(),
    );
  }, 20000);
});

describe('bringing one back', () => {
  test('the archive tab offers exactly one move, and it restores', async () => {
    renderView();

    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    expect(await menuOf('Karlín 7')).toEqual(['Вернуть в работу']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Вернуть в работу' }));

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

// 5.4, «Объекты» variant B (docs/design/decisions.md §2): the registry and the
// card side by side; the open listing and the card's tab live in the address.
describe('the registry and the card side by side', () => {
  test('opens the card of the listing the address names, beside the registry', () => {
    window.history.replaceState(null, '', '/apartments?listing=101&card=bookings');

    renderView();

    expectPageTitle('Объекты');
    expect(card()).toHaveTextContent('101:bookings');
    expect(rowFor('Royal Cerna')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vinohrady 12' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('with nothing open, the space beside says how to open a card', () => {
    renderView();

    expect(card()).toBeNull();
    expect(screen.getByText('Выберите объект — его карточка откроется здесь.')).toBeInTheDocument();
  });

  test('a press on a listing opens its card, and «Назад» closes it again', async () => {
    // At the end of jsdom's history, so a step adds one.
    window.history.pushState(null, '', '/apartments');
    renderView();
    const steps = window.history.length;

    await userEvent.click(screen.getByRole('link', { name: 'Vinohrady 12' }));
    expect(query()).toBe('listing=101');
    expect(window.history.length).toBe(steps + 1);
    expect(card()).toHaveTextContent('101:info');

    await act(() => goBack());
    expect(query()).toBe('');
    expect(card()).toBeNull();
  });

  test('a new tab of the card is a step «Назад» walks back too', async () => {
    window.history.pushState(null, '', '/apartments?listing=101');
    renderView();
    const steps = window.history.length;

    await userEvent.click(screen.getByRole('button', { name: 'К бронированиям' }));
    expect(query()).toBe('listing=101&card=bookings');
    expect(window.history.length).toBe(steps + 1);

    await act(() => goBack());
    expect(card()).toHaveTextContent('101:info');
  });

  test('the status tab is a step, the search is not', async () => {
    window.history.pushState(null, '', '/apartments');
    renderView();
    const steps = window.history.length;

    await userEvent.type(screen.getByLabelText(/Поиск/), 'karl');
    expect(window.history.length).toBe(steps);
    await userEvent.click(screen.getByRole('tab', { name: /Архив/ }));
    expect(window.history.length).toBe(steps + 1);
    expect(query()).toBe('status=archived&q=karl');
  });

  test("a listing's link keeps the registry's tab and search, for a new window too", () => {
    window.history.replaceState(null, '', '/apartments?status=archived&q=karl');

    renderView();

    expect(screen.getByRole('link', { name: 'Karlín 7' })).toHaveAttribute(
      'href',
      '/apartments?status=archived&q=karl&listing=103',
    );
  });

  // Decision 14: on a phone the card does not squeeze beside the list — it
  // takes the list's place, and «Все объекты» brings the list back.
  test('on a narrow screen an open card takes the place of the list', async () => {
    window.history.replaceState(null, '', '/apartments?listing=101');
    const { container } = renderView();

    expect(container.querySelector('[data-slot="registry"]')).toHaveClass('hidden', 'xl:flex');
    const back = screen.getByRole('button', { name: 'Все объекты' });
    expect(back).toHaveClass('xl:hidden', 'h-11');

    await userEvent.click(back);
    expect(query()).toBe('');
    expect(container.querySelector('[data-slot="registry"]')).not.toHaveClass('hidden');
  });
});

// The registry's rows (5.4): narrow enough to stand beside the card.
describe('a row of the registry', () => {
  test('offers the moves of its tab in its menu, the archive in the destructive colour', async () => {
    renderView();

    expect(await menuOf('Vinohrady 12')).toEqual(['На обслуживание', 'В архив']);
    expect(screen.getByRole('menuitem', { name: 'В архив' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
  });

  test('says where the flat is and its Hostaway id under its name', () => {
    renderView();

    const row = rowFor('Vinohrady 12');
    expect(row).toHaveTextContent('Korunní 12, Praha');
    expect(within(row).getByText('101')).toBeInTheDocument();
  });

  test('every target in it is 44 px: the tick, the group, the name and the menu', () => {
    renderView();

    const row = rowFor('Royal Cerna');
    expect(within(row).getByRole('checkbox').closest('label')).toHaveClass('size-11');
    expect(within(row).getByRole('button', { name: 'Скрыть единицы «Royal Cerna»' })).toHaveClass(
      'size-11',
    );
    expect(within(row).getByRole('link', { name: 'Royal Cerna' })).toHaveClass('min-h-11');
    expect(within(row).getByRole('button', { name: 'Действия: Royal Cerna' })).toHaveClass(
      'size-11',
    );
    expect(screen.getByLabelText(/Поиск/)).toHaveClass('h-11');
  });

  test('a listing in another state wears its state’s tone', async () => {
    renderView();
    await userEvent.click(screen.getByRole('tab', { name: /Обслуживание/ }));

    expect(within(rowFor('Anděl 4')).getByText('Обслуживание')).toHaveClass(
      'bg-tone-in-progress-bg',
    );
  });
});
