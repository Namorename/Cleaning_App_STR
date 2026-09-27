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

/** A room of Vinohrady 12, as the sync writes one: Hostaway names its listing. */
const ROOM = 1000000064266;

const roomDetail = propertyDetailSchema.parse({
  ...detail,
  id: ROOM,
  name: '1 - 2109',
  parent_id: WHOLE,
  hostaway_unit_id: 64266,
  cleaner_notes: null,
  internal_notes: null,
});

const registry: Property[] = [
  listing({ id: WHOLE, name: 'Vinohrady 12' }),
  listing({ id: UNIT_A, name: 'Room A', parent_id: WHOLE }),
  listing({ id: OTHER, name: 'Anděl 4' }),
  listing({ id: GONE, name: 'Karlín 7', status: 'archived' }),
  listing({ id: ROOM, name: '1 - 2109', parent_id: WHOLE, hostaway_unit_id: 64266 }),
];

/** The listing's checklist, which is what a room's cleaning resolves to. */
const listingChecklist = [
  { id: 'm1', title: 'Кухня', items: [{ id: 'i1', title: 'Помыть плиту', is_optional: false }] },
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
// A query whose refetch failed keeps its data: `hasData` with `isError` is that case.
const propertyState = { isError: false, hasData: true };

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

/**
 * As `property_maintenance_tasks` returns them: the technician flat rather
 * than embedded, and `unit_name` saying which door inside the house — null
 * when the job stands on the house itself.
 */
const maintenanceJobs = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    title: 'Поменять смеситель',
    status: 'done',
    scheduled_date: '2026-09-02',
    completed_at: '2026-09-02T12:00:00+00:00',
    assignee_name: 'Petr Tech',
    property_id: 101,
    unit_name: null,
  },
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    title: 'Заменить замок',
    status: 'assigned',
    scheduled_date: '2026-09-03',
    completed_at: null,
    assignee_name: null,
    property_id: 1000000064266,
    unit_name: '1 - 2109',
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
    property_id: 101,
    unit_name: null,
  },
  // Filed from a cleaning, so it stands on the room the cleaner was working.
  // Before the fold the house's card showed nothing of it at all.
  {
    id: 'cccccccc-cccc-4ccc-8ccc-000000000002',
    title: 'Не закрывается окно',
    status: 'open',
    priority: 'normal',
    created_at: '2026-09-01T09:00:00+00:00',
    resolved_at: null,
    property_id: 1000000064266,
    unit_name: '1 - 2109',
  },
];

const setStatus = vi.fn();
const countOpenCleanings = vi.fn();

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));

vi.mock('../api', () => ({
  countOpenCleanings: (...args: unknown[]) => countOpenCleanings(...args),
}));

/** Which card is open: the listing, or one of its rooms. */
const cardState = { subject: detail };
const saveChecklist = vi.fn();
const copyChecklist = vi.fn();

vi.mock('../use-apartments', () => ({
  useProperty: () => ({
    data: propertyState.hasData ? cardState.subject : undefined,
    isPending: false,
    isError: propertyState.isError,
  }),
  useChecklist: () => ({ data: listingChecklist, isPending: false, isError: false }),
  useChecklistOwner: () => ({ data: WHOLE, isPending: false, isError: false }),
  useSaveChecklist: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: saveChecklist,
  }),
  useCopyChecklist: () => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: copyChecklist,
  }),
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
  cardState.subject = detail;
  infoState.isSuccess = false;
  infoState.isError = false;
  propertyState.isError = false;
  propertyState.hasData = true;
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

    expect(screen.getByLabelText('Заметка для горничной')).toHaveValue('Ключ у консьержа');
    expect(screen.getByLabelText('Внутренняя заметка')).toHaveValue('Владелец придирчив');
  });

  test('saving sends the three columns the sync does not touch', async () => {
    renderCard();

    await userEvent.clear(screen.getByLabelText('Заметка для горничной'));
    await userEvent.type(screen.getByLabelText('Заметка для горничной'), 'Код 1234');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(saveInfo).toHaveBeenCalledWith({
      parentId: null,
      hasParentChoice: true,
      cleanerNotes: 'Код 1234',
      internalNotes: 'Владелец придирчив',
    });
  }, 20000);
});

describe('a refresh that fails does not take the form away', () => {
  test('what the manager typed stays when a refresh fails over data already shown', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const card = () => (
      <QueryClientProvider client={client}>
        <PropertyCard propertyId={WHOLE} />
      </QueryClientProvider>
    );
    const view = render(card());
    await userEvent.clear(screen.getByLabelText('Внутренняя заметка'));
    await userEvent.type(screen.getByLabelText('Внутренняя заметка'), 'Звонить заранее');

    // The save failed, the cache was refreshed, and the refresh failed too.
    propertyState.isError = true;
    view.rerender(card());

    expect(screen.queryByText('Не удалось загрузить объекты.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Внутренняя заметка')).toHaveValue('Звонить заранее');
  }, 20000);

  test('a first load that fails still says so', () => {
    propertyState.isError = true;
    propertyState.hasData = false;

    renderCard();

    expect(screen.getByText('Не удалось загрузить объекты.')).toBeInTheDocument();
  });
});

describe('listings that belong together', () => {
  test('the units are listed and lead to their own cards', () => {
    renderCard();

    expect(screen.getByRole('link', { name: 'Room A' })).toHaveAttribute(
      'href',
      `/apartments/${UNIT_A}`,
    );
  });

  // guard_property_hierarchy: a listing with units cannot become a part.
  test('a listing with units of its own is offered no parent at all', () => {
    renderCard();

    expect(screen.queryByLabelText('Часть объекта')).toBeNull();
  });

  test('a listing on its own is offered listings with no parent of their own', () => {
    cardState.subject = propertyDetailSchema.parse({ ...detail, id: OTHER, name: 'Anděl 4' });
    renderCard();

    const offered = within(screen.getByLabelText('Часть объекта'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(offered).toContain('Vinohrady 12');
    // Not itself, not a part or a room — the tree is two levels — and an
    // archived listing is nobody's parent.
    expect(offered).not.toContain('Anděl 4');
    expect(offered).not.toContain('Room A');
    expect(offered).not.toContain('1 - 2109');
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
    expect(screen.getByText(/Репорты \(открытых: 2\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Течёт кран' })).toHaveAttribute(
      'href',
      '/problems/cccccccc-cccc-4ccc-8ccc-000000000001',
    );
  });

  // The card is a house. A report filed from a cleaning stands on the room the
  // cleaner was working, so before the fold the house showed none of its own
  // breakages — and showing them without saying which door would only move the
  // question rather than answer it.
  test('what stands in a room is listed too, and says which room', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Обслуживание' }));

    expect(screen.getByRole('link', { name: 'Не закрывается окно' })).toBeInTheDocument();
    expect(screen.getByText('Заменить замок')).toBeInTheDocument();
    expect(screen.getAllByText('в комнате «1 - 2109»')).toHaveLength(2);
  });

  test('and what stands on the house itself names no room', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Обслуживание' }));

    const onTheHouse = screen.getByText('Поменять смеситель');
    expect(onTheHouse.textContent).not.toContain('в комнате');
  });
});

/**
 * A room's card (docs/f10-plan.md, 7.1, trap 5): the registry and the list of
 * units now lead here, and each tab says where the room's things really live.
 */
describe('the card of a room', () => {
  beforeEach(() => {
    cardState.subject = roomDetail;
  });

  test('names its listing as text, with no choice of parent', () => {
    renderCard();

    expect(screen.queryByLabelText('Часть объекта')).toBeNull();
    expect(screen.getByRole('link', { name: 'Vinohrady 12' })).toHaveAttribute(
      'href',
      `/apartments/${WHOLE}`,
    );
  });

  test('saving leaves the parent out — the sync owns it', async () => {
    renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(saveInfo).toHaveBeenCalledWith(expect.objectContaining({ hasParentChoice: false }));
  });

  // A link of its own on the room would beat the listing's auto link in the
  // generator, and the screen never makes one (20260912140000).
  test('shows the listing’s cleaners, and writes none', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Клинеры' }));

    expect(screen.getByText(/Maria Test/)).toBeInTheDocument();
    expect(screen.getByText(/Petr Tech/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Добавить/ })).toBeNull();
    expect(saveLink).not.toHaveBeenCalled();
  });

  test('sends the manager to the listing for its bookings', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Бронирования' }));

    expect(screen.queryByText('Jan Novák')).toBeNull();
    expect(screen.getByRole('link', { name: 'Vinohrady 12' })).toHaveAttribute(
      'href',
      `/apartments/${WHOLE}`,
    );
  });

  // Saving here would give the room a checklist of its own (owner's decision:
  // a room has only the inherited one).
  test('shows the inherited checklist to read, with nothing to edit', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('tab', { name: 'Чек-лист' }));

    expect(screen.getByText('Кухня')).toBeInTheDocument();
    expect(screen.getByText('Помыть плиту')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скопировать' })).toBeNull();
    expect(saveChecklist).not.toHaveBeenCalled();
  });
});
