import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { propertyDetailSchema, propertySchema, type Property } from '../schema';

const WHOLE = 571441;
const UNIT_A = 566761;
const OTHER = 900001;
const GONE = 900002;

const listing = (overrides: Record<string, unknown>): Property =>
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

const detail = propertyDetailSchema.parse({
  id: WHOLE,
  name: 'Vinohrady 12',
  address: 'Korunní 12',
  city: 'Praha',
  status: 'active',
  parent_id: null,
  bedrooms: 2,
  max_guests: 4,
  country_code: 'CZ',
  timezone: 'Europe/Prague',
  bathrooms: 1,
  check_in_time: '15:00:00',
  check_out_time: '10:00:00',
  cleaner_notes: 'Ключ у консьержа',
  internal_notes: 'Владелец придирчив',
  synced_at: '2026-09-11T03:00:00+00:00',
});

const registry: Property[] = [
  listing({ id: WHOLE, name: 'Vinohrady 12' }),
  listing({ id: UNIT_A, name: 'Room A', parent_id: WHOLE }),
  listing({ id: OTHER, name: 'Anděl 4' }),
  listing({ id: GONE, name: 'Karlín 7', status: 'archived' }),
];

const MARIA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const PETR = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const OLGA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003';
/** A cleaner who is not on this flat: the one the picker should offer. */
const NINA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004';

const person = (id: string, full_name: string, role: string) => ({
  id,
  full_name,
  email: null,
  phone: null,
  role,
  preferred_language: null,
  is_active: true,
  created_at: '2026-09-01T08:00:00+00:00',
});

const staff = [
  person(MARIA, 'Maria Test', 'cleaner'),
  person(PETR, 'Petr Tech', 'tech'),
  person(OLGA, 'Olga Manager', 'manager'),
  person(NINA, 'Nina Free', 'cleaner'),
];

const links = [
  { property_id: WHOLE, cleaner_id: PETR, mode: 'claim', priority: 2 },
  { property_id: WHOLE, cleaner_id: MARIA, mode: 'auto', priority: 1 },
  { property_id: OTHER, cleaner_id: MARIA, mode: 'claim', priority: 1 },
];

const saveInfo = vi.fn();
const saveLink = vi.fn();
const removeLink = vi.fn();
const infoState = { isPending: false, isError: false, isSuccess: false, error: null as unknown };

const reservations = [
  {
    id: 9001,
    arrival_date: '2999-01-10',
    departure_date: '2999-01-14',
    guest_name: 'Jan Novák',
    guests_count: 2,
    status: 'new',
    is_block: false,
  },
  {
    id: 9002,
    arrival_date: '2020-03-01',
    departure_date: '2020-03-08',
    guest_name: null,
    guests_count: null,
    status: 'new',
    is_block: true,
  },
];

const maintenanceJobs = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    title: 'Поменять смеситель',
    status: 'done',
    scheduled_date: '2026-09-02',
    completed_at: '2026-09-02T12:00:00+00:00',
    assignee: { full_name: 'Petr Tech' },
  },
];

const reports = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
    title: 'Течёт кран',
    status: 'open',
    priority: 'high',
    created_at: '2026-09-01T08:00:00+00:00',
    resolved_at: null,
  },
];

const setStatus = vi.fn();
const countOpenCleanings = vi.fn();

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('../api', () => ({
  countOpenCleanings: (...args: unknown[]) => countOpenCleanings(...args),
}));

vi.mock('../use-apartments', () => ({
  useProperty: () => ({ data: detail, isPending: false, isError: false }),
  useRegistry: () => ({ data: registry, isPending: false, isError: false }),
  useSaveInfo: () => ({ ...infoState, mutate: saveInfo }),
  useReservations: () => ({ data: reservations, isPending: false, isError: false }),
  useMaintenance: () => ({ data: maintenanceJobs, isPending: false, isError: false }),
  usePropertyProblems: () => ({ data: reports, isPending: false, isError: false }),
  useSetStatus: () => ({ isPending: false, mutateAsync: setStatus }),
}));

vi.mock('@/features/team/use-team', () => ({
  useStaff: () => ({ data: staff, isPending: false, isError: false }),
  useCleanerLinks: () => ({ data: links, isPending: false, isError: false }),
  useSaveCleanerLink: () => ({ isPending: false, isError: false, error: null, mutate: saveLink }),
  useRemoveCleanerLink: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: removeLink,
  }),
}));

import { PropertyCard } from '../property-card';

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PropertyCard propertyId={WHOLE} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  infoState.isSuccess = false;
  infoState.isError = false;
  setStatus.mockResolvedValue(undefined);
  countOpenCleanings.mockResolvedValue(0);
});

describe('what Hostaway owns is shown, not offered for editing', () => {
  test('the address and the cleaning window are plain text', () => {
    renderCard();

    expect(screen.getByText('Korunní 12')).toBeInTheDocument();
    // The window reads out — in, the way a cleaning runs.
    expect(screen.getByText('10:00 — 15:00')).toBeInTheDocument();
    // And there is no box to type either of them into.
    expect(screen.queryByLabelText('Адрес')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Окно уборки/)).not.toBeInTheDocument();
  });

  test('and the card says why they are not editable here', () => {
    renderCard();

    expect(screen.getByText(/перезаписываются при каждой синхронизации/)).toBeInTheDocument();
  });
});

describe('what the company owns is edited here', () => {
  test('the notes are filled in from the row', () => {
    renderCard();

    expect(screen.getByLabelText('Заметка для уборщицы')).toHaveValue('Ключ у консьержа');
    expect(screen.getByLabelText('Внутренняя заметка')).toHaveValue('Владелец придирчив');
  });

  test('saving sends the three columns the sync does not touch', async () => {
    renderCard();

    await userEvent.clear(screen.getByLabelText('Заметка для уборщицы'));
    await userEvent.type(screen.getByLabelText('Заметка для уборщицы'), 'Код 1234');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(saveInfo).toHaveBeenCalledWith({
      parentId: null,
      cleanerNotes: 'Код 1234',
      internalNotes: 'Владелец придирчив',
    });
  }, 20000);
});

describe('listings that belong together', () => {
  test('the units are listed and lead to their own cards', () => {
    renderCard();

    expect(screen.getByRole('link', { name: 'Room A' })).toHaveAttribute(
      'href',
      `/apartments/${UNIT_A}`,
    );
  });

  test('a listing is never offered itself or its own unit as a parent', () => {
    renderCard();
    const parent = screen.getByLabelText('Часть объекта');

    const offered = within(parent)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toContain('Anděl 4');
    // Either would make a loop in the parent chain.
    expect(offered).not.toContain('Vinohrady 12');
    expect(offered).not.toContain('Room A');
    // And an archived listing is nobody's parent.
    expect(offered).not.toContain('Karlín 7');
  });
});

describe('who works the flat', () => {
  test('the fixed cleaner comes before the queue', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Клинеры' }));

    const names = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(names[0]).toContain('Maria Test');
    expect(names[1]).toContain('Petr Tech');
  });

  test('somebody already on it is not offered again, and a manager never is', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Клинеры' }));

    const picker = screen.getByLabelText(/Добавить исполнителя/);
    const offered = within(picker)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).not.toContain('Maria Test');
    expect(offered).not.toContain('Olga Manager');
    // Petr is already in its queue, so he is not on offer either.
    expect(offered).not.toContain('Petr Tech');
    expect(offered).toContain('Nina Free');
  });

  test('taking somebody off the flat', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Клинеры' }));

    const row = screen.getAllByRole('listitem')[0];
    await userEvent.click(within(row).getByRole('button', { name: 'Убрать' }));

    await waitFor(() =>
      expect(removeLink).toHaveBeenCalledWith({ propertyId: WHOLE, cleanerId: MARIA }),
    );
  });
});

describe('what is booked on the flat', () => {
  test('a guest is named and a booking still ahead is marked', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Бронирования' }));

    const row = screen.getAllByRole('row').find((one) => one.textContent?.includes('Jan Novák'));
    expect(row).toBeDefined();
    expect(within(row as HTMLElement).getByText('Впереди')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('2999-01-10 — 2999-01-14')).toBeInTheDocument();
  });

  test('a block is not shown as a nameless guest', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Бронирования' }));

    // An owner stay or a closed week comes through Hostaway as a reservation
    // with no guest; leaving it blank would read as a booking somebody lost.
    expect(screen.getByText('Блок (не гость)')).toBeInTheDocument();
    expect(screen.queryByText('Без имени')).not.toBeInTheDocument();
  });
});

describe('maintenance', () => {
  test('the state is shown with the moves available from it', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Обслуживание' }));

    expect(screen.getByRole('button', { name: 'На обслуживание' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'В архив' })).toBeInTheDocument();
    // The flat is already working, so there is nothing to restore it from.
    expect(screen.queryByRole('button', { name: 'Вернуть в работу' })).not.toBeInTheDocument();
  });

  test('changing the state still asks first', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Обслуживание' }));
    await userEvent.click(screen.getByRole('button', { name: 'На обслуживание' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Отправить на обслуживание?')).toBeInTheDocument();
    expect(setStatus).not.toHaveBeenCalled();
  }, 20000);

  test('the work and the reports on this flat are listed', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Обслуживание' }));

    expect(screen.getByText('Поменять смеситель')).toBeInTheDocument();
    expect(screen.getByText(/Репорты \(открытых: 1\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Течёт кран' })).toHaveAttribute(
      'href',
      '/problems/cccccccc-cccc-4ccc-8ccc-000000000001',
    );
  });
});
