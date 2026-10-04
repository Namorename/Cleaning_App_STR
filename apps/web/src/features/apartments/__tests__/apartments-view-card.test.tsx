import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { propertyDetailSchema, propertySchema, type Property } from '../schema';

/**
 * The registry with the real card beside it (apartments-view.test stands the
 * card in): the addresses a manager can reach that name a listing the list is
 * not showing — one that does not exist, one in another tab.
 */

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

const working = listing({ id: 101, name: 'Vinohrady 12' });
const gone = listing({ id: 103, name: 'Karlín 7', status: 'archived' });

const goneDetail = propertyDetailSchema.parse({
  ...gone,
  country_code: 'CZ',
  timezone: 'Europe/Prague',
  bathrooms: 1,
  check_in_time: '15:00:00',
  check_out_time: '10:00:00',
  cleaner_notes: null,
  internal_notes: null,
  synced_at: '2026-09-11T03:00:00+00:00',
});

vi.mock('@/lib/supabase/use-client', () => ({ useSupabase: () => ({}) }));
vi.mock('../api', () => ({ countOpenCleanings: vi.fn() }));

vi.mock('../use-apartments', () => ({
  useRegistry: () => ({ data: [working, gone], isPending: false, isError: false }),
  useOpenCleanings: () => ({ data: [], isPending: false, isError: false }),
  useSyncListings: () => ({ data: undefined, isPending: false, isError: false, mutate: vi.fn() }),
  useSetStatus: () => ({ isPending: false, mutateAsync: vi.fn() }),
  // Only Karlín 7 has a row; any other id is a listing the database does not have.
  useProperty: (id: number) => ({
    data: id === gone.id ? goneDetail : null,
    isPending: false,
    isError: false,
  }),
  useSaveInfo: () => ({ isPending: false, isError: false, isSuccess: false, mutate: vi.fn() }),
}));

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

import { ApartmentsView } from '../apartments-view';

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApartmentsView />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.history.pushState(null, '', '/apartments');
});

describe('a card the list does not show', () => {
  test('a listing that does not exist says so, and «Все объекты» leads back', async () => {
    window.history.pushState(null, '', '/apartments?listing=999999');
    const { container } = renderView();

    expect(screen.getByText('Объект не найден.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Все объекты' }));

    expect(window.location.search).toBe('');
    expect(screen.queryByText('Объект не найден.')).toBeNull();
    expect(container.querySelector('[data-slot="registry"]')).not.toHaveClass('hidden');
  });

  // An archived flat opens like any other — a manager about to bring it back
  // looks at it first — while the registry stays on the tab it was on.
  test('an archived listing opens beside the working tab, which keeps it out', async () => {
    window.history.pushState(null, '', '/apartments?listing=103');
    renderView();

    expect(screen.getByRole('heading', { level: 2, name: 'Karlín 7' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Работают/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('link', { name: 'Karlín 7' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Все объекты' }));
    expect(screen.queryByRole('heading', { level: 2, name: 'Karlín 7' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Vinohrady 12' })).toBeInTheDocument();
  });
});
