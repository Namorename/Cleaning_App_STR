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

/** Two cleanings stand on Vinohrady 12 and none anywhere else. */
const openCleanings = [{ property_id: 101 }, { property_id: 101 }];

const setStatus = vi.fn();
const sync = vi.fn();
const syncState = {
  data: undefined as unknown,
  isPending: false,
  isError: false,
  error: null as unknown,
};
const countOpenCleanings = vi.fn();

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('../api', () => ({
  countOpenCleanings: (...args: unknown[]) => countOpenCleanings(...args),
}));

vi.mock('../use-apartments', () => ({
  useRegistry: () => ({ data: [working, repaired, gone, unit], isPending: false, isError: false }),
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
  setStatus.mockResolvedValue(undefined);
  countOpenCleanings.mockResolvedValue(2);
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
