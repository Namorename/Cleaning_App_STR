import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { supplyRequestSchema, type SupplyRequest } from '../schema';

const NEW_ID = '11111111-1111-4111-8111-111111111111';
const NEW_2_ID = '55555555-5555-4555-8555-555555555555';
const DONE_ID = '33333333-3333-4333-8333-333333333333';
const REJECTED_ID = '66666666-6666-4666-8666-666666666666';
const NOBODY_HAS_ID = '99999999-9999-4999-8999-999999999999';

const base = {
  requested_by: '22222222-2222-4222-8222-222222222222',
  property_id: 1,
  task_id: null,
  priority: 'normal',
  note: null,
  needed_by: null,
  reviewed_at: null,
  fulfilled_at: null,
  reject_reason: null,
  created_at: '2026-09-09T10:00:00+00:00',
  property: { name: 'Vinohrady 12' },
  requester: { full_name: 'Maria Test', role: 'cleaner' },
};

const item = (id: string, name: string, quantity: number, unit = 'pcs', sort_order = 1) => ({
  id,
  name,
  quantity,
  unit,
  comment: null,
  sort_order,
});

const requests: SupplyRequest[] = [
  supplyRequestSchema.parse({
    ...base,
    id: NEW_ID,
    status: 'new',
    priority: 'urgent',
    items: [
      item('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'Средство для стёкол', 2),
      item('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'Мешки для мусора', 1, 'pack', 2),
    ],
  }),
  supplyRequestSchema.parse({
    ...base,
    id: NEW_2_ID,
    status: 'new',
    note: 'Закончились в обоих санузлах',
    needed_by: '2026-09-12',
    property: { name: 'Karlín 3' },
    items: [item('aaaaaaaa-aaaa-4aaa-8aaa-000000000003', 'средство для стёкол', 3)],
  }),
  supplyRequestSchema.parse({
    ...base,
    id: DONE_ID,
    status: 'fulfilled',
    property: { name: 'Smíchov 8' },
    reviewed_at: '2026-09-09T12:00:00+00:00',
    fulfilled_at: '2026-09-10T12:00:00+00:00',
    items: [item('aaaaaaaa-aaaa-4aaa-8aaa-000000000004', 'Губки', 10)],
  }),
];

const rejected: SupplyRequest = supplyRequestSchema.parse({
  ...base,
  id: REJECTED_ID,
  status: 'rejected',
  property: { name: 'Žižkov 1' },
  reviewed_at: '2026-09-09T12:00:00+00:00',
  reject_reason: 'Есть на складе',
  items: [item('aaaaaaaa-aaaa-4aaa-8aaa-000000000005', 'Швабра', 1)],
});

const CATALOG_ID = '77777777-7777-4777-8777-777777777777';
const catalog = [
  {
    id: CATALOG_ID,
    name: 'Средство для стёкол',
    name_i18n: { en: 'Glass cleaner' },
    unit: 'l',
    sort_order: 1,
    archived_at: null,
  },
];

const listState = {
  data: requests as SupplyRequest[] | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
};
const reviewState = { isPending: false, isError: false, error: null as unknown };
const review = vi.fn();
const resetReview = vi.fn();
const saveCatalogItem = vi.fn();
const archiveCatalogItem = vi.fn();
const idle = { isPending: false, isError: false, error: null };
vi.mock('../use-supplies', () => ({
  useSupplyRequests: () => listState,
  useReviewSupplyRequest: () => ({ ...reviewState, mutate: review, reset: resetReview }),
  useCatalog: () => ({ data: catalog, isPending: false, isError: false }),
  useCompanyLanguage: () => ({ data: 'ru', isPending: false, isError: false }),
  useSaveCatalogItem: () => ({ ...idle, mutate: saveCatalogItem }),
  useArchiveCatalogItem: () => ({ ...idle, mutate: archiveCatalogItem }),
}));

const downloadFile = vi.fn();
vi.mock('@/lib/download', () => ({ downloadFile: (...args: unknown[]) => downloadFile(...args) }));

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

import { expectPageTitle } from '@/components/page-header.expect';

import { SuppliesView } from '../supplies-view';

/** jsdom's Blob has no text(); the reader route works there and in browsers alike. */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

/** The query of the page's address, without its `?`. */
const query = () => window.location.search.slice(1);

/** «Назад»: jsdom walks the history a task later and says so with `popstate`. */
function goBack(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener('popstate', () => resolve(), { once: true });
    window.history.back();
  });
}

/** The open request: a section named by its h2. */
const detail = (name: string): HTMLElement => screen.getByRole('region', { name });
const rowLink = (name: string): HTMLElement => screen.getByRole('link', { name: new RegExp(name) });
const tab = (name: string): HTMLElement => screen.getByRole('tab', { name: new RegExp(name) });
const PICK_HINT = 'Выберите заявку — она откроется здесь.';

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/supplies');
  listState.data = requests;
  listState.isPending = false;
  listState.isError = false;
  listState.error = null;
  reviewState.isError = false;
  reviewState.error = null;
});

describe('the page', () => {
  test('is headed by the common header, the catalogue and the summary among its actions', () => {
    render(<SuppliesView />);

    expectPageTitle('Заявки на расходники');
    const actions = screen
      .getByRole('heading', { level: 1 })
      .closest('[data-slot="page-header"]') as HTMLElement;
    expect(within(actions).getByRole('button', { name: 'Каталог расходников' })).toHaveClass(
      'h-11',
    );
    expect(within(actions).getByRole('button', { name: 'Свести к закупке' })).toHaveClass('h-11');
  });

  test('a refresh that fails keeps the requests already on screen', () => {
    listState.isError = true;
    listState.error = { message: 'network' };

    render(<SuppliesView />);

    expect(rowLink('Karlín 3')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить заявки')).not.toBeInTheDocument();
  });

  test('a first load that fails says so in words, the server’s text small under it', () => {
    listState.data = undefined;
    listState.isError = true;
    listState.error = { message: 'network down' };

    render(<SuppliesView />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось загрузить заявки');
    expect(within(alert).getByText('network down')).toHaveClass('text-xs');
  });
});

describe('the list of requests', () => {
  test('opens on the new ones, and the space beside says how to open one', () => {
    render(<SuppliesView />);

    expect(tab('Новые')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Новые')).toHaveTextContent('2');
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /Smíchov 8/ })).not.toBeInTheDocument();
    expect(screen.getByText(PICK_HINT)).toBeInTheDocument();
    // The lines wait for the request to be opened: no table on the list.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('a row says where, when, how far along, how urgent, who asked and what', () => {
    render(<SuppliesView />);

    const row = rowLink('Vinohrady 12');
    expect(row).toHaveTextContent('9 сент. 2026');
    expect(within(row).getByText('Новая')).toHaveClass('bg-tone-unassigned-bg');
    expect(within(row).getByText('Срочно')).toHaveClass('bg-tone-urgent-bg');
    expect(row).toHaveTextContent('Maria Test');
    expect(row).toHaveTextContent('Средство для стёкол и ещё 1');
    expect(within(rowLink('Karlín 3')).queryByText('Срочно')).not.toBeInTheDocument();
  });

  test('a row is a link of at least 52 px', () => {
    render(<SuppliesView />);

    expect(rowLink('Karlín 3')).toHaveClass('min-h-13');
  });

  test('the status tab is a step «Назад» walks back', async () => {
    window.history.pushState(null, '', '/supplies');
    render(<SuppliesView />);
    const steps = window.history.length;

    await userEvent.click(tab('Выполненные'));
    expect(query()).toBe('tab=fulfilled');
    expect(window.history.length).toBe(steps + 1);
    expect(rowLink('Smíchov 8')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Karlín 3/ })).not.toBeInTheDocument();

    await act(() => goBack());
    expect(query()).toBe('');
    expect(tab('Новые')).toHaveAttribute('aria-selected', 'true');
  });

  test('the search narrows the list and the counters, in place', async () => {
    window.history.pushState(null, '', '/supplies');
    render(<SuppliesView />);
    const steps = window.history.length;

    await userEvent.type(screen.getByRole('searchbox'), 'karlin');
    expect(window.history.length).toBe(steps);
    expect(query()).toBe('q=karlin');
    expect(tab('Новые')).toHaveTextContent('1');
    expect(screen.queryByRole('link', { name: /Vinohrady 12/ })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox'));
    await userEvent.type(screen.getByRole('searchbox'), 'губки');
    expect(tab('Новые')).toHaveTextContent('0');
    expect(tab('Выполненные')).toHaveTextContent('1');
  }, 20000);

  test('the two dates say which end is which and narrow in place; the reset clears all', async () => {
    window.history.pushState(null, '', '/supplies?q=karlin');
    render(<SuppliesView />);
    const steps = window.history.length;

    const from = screen.getByLabelText('Дата с');
    expect(screen.getByText('Дата с').tagName).toBe('LABEL');
    expect(from).toHaveClass('h-11');
    expect(screen.getByLabelText('Дата по')).toHaveClass('h-11');

    // Everything in the fixture was created on 2026-09-09.
    await userEvent.type(from, '2026-09-10');
    expect(window.history.length).toBe(steps);
    expect(query()).toBe('q=karlin&from=2026-09-10');
    expect(tab('Новые')).toHaveTextContent('0');
    expect(screen.getByText('В этой вкладке заявок нет')).toBeInTheDocument();

    const reset = screen.getByRole('button', { name: 'Сбросить фильтры' });
    expect(reset).toHaveClass('h-11');
    await userEvent.click(reset);
    expect(query()).toBe('');
    expect(tab('Новые')).toHaveTextContent('2');
  }, 20000);

  // Four tabs with their counters are wider than a phone in Russian and Czech:
  // they wrap onto a second row rather than widen the page (decision 14).
  test('the four tabs wrap rather than widen the page', () => {
    render(<SuppliesView />);

    expect(screen.getByRole('tablist')).toHaveClass('h-auto', 'flex-wrap', 'justify-start');
  });

  test('the search, the dates and the tabs are 44 px targets', () => {
    render(<SuppliesView />);

    expect(screen.getByRole('searchbox')).toHaveClass('h-11');
    for (const one of screen.getAllByRole('tab')) {
      expect(one).toHaveClass('min-h-11');
    }
  });
});

describe('the request beside the list', () => {
  test('opens the request the address names, its row marked', () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);

    render(<SuppliesView />);

    expectPageTitle('Заявки на расходники');
    expect(screen.getByRole('heading', { level: 2, name: 'Karlín 3' })).toBeInTheDocument();
    expect(rowLink('Karlín 3')).toHaveAttribute('aria-current', 'true');
    expect(rowLink('Vinohrady 12')).not.toHaveAttribute('aria-current');
    expect(screen.queryByText(PICK_HINT)).not.toBeInTheDocument();
  });

  test('a press on a row opens it as a step, and «Назад» closes it again', async () => {
    window.history.pushState(null, '', '/supplies');
    render(<SuppliesView />);
    const steps = window.history.length;

    await userEvent.click(rowLink('Vinohrady 12'));
    expect(query()).toBe(`request=${NEW_ID}`);
    expect(window.history.length).toBe(steps + 1);
    expect(screen.getByRole('heading', { level: 2, name: 'Vinohrady 12' })).toBeInTheDocument();

    await act(() => goBack());
    expect(query()).toBe('');
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
    expect(screen.getByText(PICK_HINT)).toBeInTheDocument();
  });

  test('shows the lines, the note, who asked and the dates in the reader’s format', () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);

    render(<SuppliesView />);

    const open = detail('Karlín 3');
    expect(within(open).getByText('Новая')).toHaveClass('bg-tone-unassigned-bg');
    expect(within(open).getByTitle('Горничная')).toHaveTextContent('Maria Test');
    expect(open).toHaveTextContent('Создана 9 сент. 2026');
    expect(open).toHaveTextContent('Нужно к 12 сент. 2026');
    expect(within(open).getByRole('heading', { level: 3, name: 'Позиции: 1' })).toBeInTheDocument();
    const line = within(open).getByText('средство для стёкол').closest('tr') as HTMLElement;
    expect(line).toHaveTextContent('3 шт');
    expect(
      within(open).getByRole('heading', { level: 3, name: 'Комментарий' }),
    ).toBeInTheDocument();
    expect(open).toHaveTextContent('Закончились в обоих санузлах');
  });

  test('another urgent request says so beside its status', () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_ID}`);

    render(<SuppliesView />);

    const open = detail('Vinohrady 12');
    expect(within(open).getByText('Срочно')).toHaveClass('bg-tone-urgent-bg');
    expect(within(open).getByText('1 упак')).toBeInTheDocument();
  });

  test('a request the tab does not hold still opens beside it', () => {
    window.history.replaceState(null, '', `/supplies?tab=fulfilled&request=${NEW_ID}`);

    render(<SuppliesView />);

    expect(detail('Vinohrady 12')).toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(1);
    expect(rowLink('Smíchov 8')).toBeInTheDocument();
  });

  test('a request nobody has is not found, and the way back still works', async () => {
    window.history.replaceState(null, '', `/supplies?request=${NOBODY_HAS_ID}`);
    render(<SuppliesView />);

    expect(screen.getByText('Заявка не найдена')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Все заявки' }));
    expect(query()).toBe('');
  });

  test('a row’s link keeps the tab and the search, for a new window too', () => {
    window.history.replaceState(null, '', '/supplies?tab=all&q=karlin');

    render(<SuppliesView />);

    expect(rowLink('Karlín 3')).toHaveAttribute(
      'href',
      `/supplies?tab=all&q=karlin&request=${NEW_2_ID}`,
    );
  });

  // A link is a real address: a new tab, a new window, a download are the
  // browser's business, not a request opened in place.
  test.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['the middle button', { button: 1 }],
  ])('a press with %s is left to the browser', (_how, init) => {
    render(<SuppliesView />);
    let wasPrevented: boolean | null = null;
    const watch = (event: Event) => {
      wasPrevented = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', watch);

    fireEvent.click(rowLink('Karlín 3'), init);
    document.removeEventListener('click', watch);

    expect(wasPrevented).toBe(false);
    expect(query()).toBe('');
  });
});

describe('the moves over the open request', () => {
  test('accepts at once and rejects only with a reason', async () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);
    render(<SuppliesView />);
    const open = detail('Karlín 3');

    await userEvent.click(within(open).getByRole('button', { name: 'Принять' }));
    expect(review).toHaveBeenCalledWith({ requestId: NEW_2_ID, status: 'accepted' });

    await userEvent.click(within(open).getByRole('button', { name: 'Отклонить' }));
    const confirm = within(open).getByRole('button', { name: 'Подтвердить отказ' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(open).getByLabelText('Причина отказа'), 'Есть на складе');
    await userEvent.click(confirm);
    expect(review).toHaveBeenCalledWith(
      { requestId: NEW_2_ID, status: 'rejected', rejectReason: 'Есть на складе' },
      expect.anything(),
    );
  });

  test('every move and every file is a 44 px target', async () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);
    render(<SuppliesView />);
    const open = detail('Karlín 3');

    for (const name of ['Принять', 'Отклонить', 'Экспорт CSV', 'Экспорт XLSX']) {
      expect(within(open).getByRole('button', { name })).toHaveClass('h-11');
    }
    await userEvent.click(within(open).getByRole('button', { name: 'Отклонить' }));
    for (const name of ['Подтвердить отказ', 'Не отклонять']) {
      expect(within(open).getByRole('button', { name })).toHaveClass('h-11');
    }
  });

  test('a refused move says so in words, the server’s text small under it', () => {
    reviewState.isError = true;
    reviewState.error = { message: 'status moved meanwhile' };
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);

    render(<SuppliesView />);

    const alert = within(detail('Karlín 3')).getByRole('alert');
    expect(alert).toHaveTextContent('Не удалось выполнить действие. Попробуйте ещё раз.');
    expect(within(alert).getByText('status moved meanwhile')).toHaveClass('text-xs');
  });

  test('leaving the reason unwritten clears the refusal shown', async () => {
    reviewState.isError = true;
    reviewState.error = { message: 'status moved meanwhile' };
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);
    render(<SuppliesView />);
    const open = detail('Karlín 3');

    await userEvent.click(within(open).getByRole('button', { name: 'Отклонить' }));
    expect(resetReview).not.toHaveBeenCalled();
    await userEvent.click(within(open).getByRole('button', { name: 'Не отклонять' }));

    expect(resetReview).toHaveBeenCalledTimes(1);
  });

  test('a fulfilled request offers no moves and says when it was done', () => {
    window.history.replaceState(null, '', `/supplies?tab=fulfilled&request=${DONE_ID}`);

    render(<SuppliesView />);

    const open = detail('Smíchov 8');
    expect(within(open).getByText('Выполнена')).toHaveClass('bg-tone-done-bg');
    expect(open).toHaveTextContent('Выполнена 10 сент. 2026');
    expect(within(open).queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument();
    expect(within(open).queryByRole('button', { name: 'Отклонить' })).not.toBeInTheDocument();
  });

  test('a rejected request shows its reason and what the cleaner sees', () => {
    listState.data = [...requests, rejected];
    window.history.replaceState(null, '', `/supplies?tab=all&request=${REJECTED_ID}`);

    render(<SuppliesView />);

    const open = detail('Žižkov 1');
    expect(open).toHaveTextContent('Причина отказа: Есть на складе');
    expect(open).toHaveTextContent('Горничная видит отказ и причину в приложении');
    expect(within(open).queryByRole('button', { name: 'Принять' })).not.toBeInTheDocument();
  });
});

describe('the files', () => {
  test('hands over the open request as a CSV and an XLSX with its header and lines', async () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);
    render(<SuppliesView />);
    const open = detail('Karlín 3');

    await userEvent.click(within(open).getByRole('button', { name: 'Экспорт CSV' }));
    await userEvent.click(within(open).getByRole('button', { name: 'Экспорт XLSX' }));

    const names = downloadFile.mock.calls.map((call) => call[0]);
    expect(names[0]).toMatch(/^request-\d{4}-\d{2}-\d{2}-55555555\.csv$/);
    expect(names[1]).toMatch(/^request-\d{4}-\d{2}-\d{2}-55555555\.xlsx$/);
    const csv = await readBlob(downloadFile.mock.calls[0]?.[1] as Blob);
    expect(csv).toContain('Объект,Karlín 3');
    expect(csv).toContain('Запросил,Maria Test');
    expect(csv).toContain('Комментарий,Закончились в обоих санузлах');
    expect(csv).toContain('Название,Кол-во,Ед.,Уточнение');
    expect(csv).toContain('средство для стёкол,3,шт,');
  });

  // A line comes from the field: «=1+2» or «+cmd» typed on a phone must reach
  // the spreadsheet as text, not as a formula.
  test('a line that looks like a formula leaves as text', async () => {
    listState.data = [
      supplyRequestSchema.parse({
        ...base,
        id: NEW_2_ID,
        status: 'new',
        property: { name: 'Karlín 3' },
        items: [{ ...item('aaaaaaaa-aaaa-4aaa-8aaa-000000000009', '=1+2', 1), comment: '+cmd' }],
      }),
    ];
    window.history.replaceState(null, '', `/supplies?request=${NEW_2_ID}`);
    render(<SuppliesView />);

    await userEvent.click(within(detail('Karlín 3')).getByRole('button', { name: 'Экспорт CSV' }));

    const csv = await readBlob(downloadFile.mock.calls[0]?.[1] as Blob);
    expect(csv).toContain("'=1+2,1,шт,'+cmd");
  });

  test('the catalogue lists entries, adds a new one and takes one off the list', async () => {
    render(<SuppliesView />);

    await userEvent.click(screen.getByRole('button', { name: 'Каталог расходников' }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('Средство для стёкол').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('en: Glass cleaner');
    expect(row).toHaveTextContent('л');

    await userEvent.type(within(dialog).getByLabelText(/Название \(русский\)/), 'Перчатки');
    await userEvent.type(within(dialog).getByLabelText('Перевод: английский'), 'Gloves');
    await userEvent.selectOptions(within(dialog).getByLabelText('Единица'), 'упак');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Добавить позицию' }));
    expect(saveCatalogItem).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Перчатки', name_i18n: { en: 'Gloves' }, unit: 'pack' }),
      expect.anything(),
    );

    await userEvent.click(within(row).getByRole('button', { name: 'Убрать из списка' }));
    expect(archiveCatalogItem).toHaveBeenCalledWith({ itemId: CATALOG_ID, archived: true });
  }, 15000);

  test('sums the same item across requests and hands over a CSV and an XLSX', async () => {
    render(<SuppliesView />);

    await userEvent.click(screen.getByRole('button', { name: 'Свести к закупке' }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('Средство для стёкол').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('5');
    expect(row).toHaveTextContent('Vinohrady 12; Karlín 3');
    expect(within(dialog).queryByText('Губки')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать CSV' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Скачать XLSX' }));
    const names = downloadFile.mock.calls.map((call) => call[0]);
    expect(names[0]).toMatch(/^purchase-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(names[1]).toMatch(/^purchase-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(await readBlob(downloadFile.mock.calls[0]?.[1] as Blob)).toContain(
      'Средство для стёкол,шт,5,Vinohrady 12; Karlín 3,2',
    );
    // Typing, a dialog and a zip in one test: slow on a loaded machine.
  }, 15000);

  // A search finds one request to read; the purchase is still the whole period's.
  test('the summary adds up every request of the dates, whatever the search', async () => {
    window.history.replaceState(null, '', '/supplies?q=karlin');
    render(<SuppliesView />);

    await userEvent.click(screen.getByRole('button', { name: 'Свести к закупке' }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('Средство для стёкол').closest('tr') as HTMLElement;
    expect(row).toHaveTextContent('Vinohrady 12; Karlín 3');
  });
});

// Decision 14: on a phone the request does not squeeze beside the list — it
// takes the list's place, and «Все заявки» brings the list back.
describe('one of the two, below xl', () => {
  const list = (container: HTMLElement) =>
    container.querySelector('[data-slot="request-list"]') as HTMLElement;

  test('an open request takes the place of the list', async () => {
    window.history.replaceState(null, '', `/supplies?request=${NEW_ID}`);
    const { container } = render(<SuppliesView />);

    expect(list(container)).toHaveClass('hidden', 'xl:flex');
    const back = screen.getByRole('button', { name: 'Все заявки' });
    expect(back).toHaveClass('xl:hidden', 'h-11');

    await userEvent.click(back);
    expect(query()).toBe('');
    expect(list(container)).not.toHaveClass('hidden');
    expect(container.querySelector('[data-slot="request-pane"]')).toHaveClass('hidden', 'xl:block');
  });

  test('opening a request from the keyboard puts the focus on its heading', async () => {
    window.history.pushState(null, '', '/supplies');
    render(<SuppliesView />);

    rowLink('Karlín 3').focus();
    await userEvent.keyboard('{Enter}');

    expect(screen.getByRole('heading', { level: 2, name: 'Karlín 3' })).toHaveFocus();
  });

  test('«Все заявки» gives the focus back to the request it closed', async () => {
    window.history.pushState(null, '', `/supplies?request=${NEW_2_ID}`);
    render(<SuppliesView />);

    await userEvent.click(screen.getByRole('button', { name: 'Все заявки' }));

    expect(rowLink('Karlín 3')).toHaveFocus();
  });

  test('a closed request the list does not show hands the focus to the search', async () => {
    window.history.pushState(null, '', `/supplies?request=${DONE_ID}`);
    render(<SuppliesView />);

    await userEvent.click(screen.getByRole('button', { name: 'Все заявки' }));

    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  describe('side by side, from xl', () => {
    const matchMedia = window.matchMedia;
    beforeEach(() => {
      window.matchMedia = ((media: string) => ({
        matches: media.includes('min-width'),
        media,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })) as unknown as typeof window.matchMedia;
    });
    afterEach(() => {
      window.matchMedia = matchMedia;
    });

    test('the focus stays on the list where it was', async () => {
      window.history.pushState(null, '', '/supplies');
      render(<SuppliesView />);

      rowLink('Karlín 3').focus();
      await userEvent.keyboard('{Enter}');

      expect(detail('Karlín 3')).toBeInTheDocument();
      expect(rowLink('Karlín 3')).toHaveFocus();
    });
  });
});
