import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { staffSchema, type CleanerLink, type Property, type Staff } from '../schema';

const MARIA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const PETR = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const OLGA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003';
const IVAN = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004';

const person = (overrides: Record<string, unknown>): Staff =>
  staffSchema.parse({
    full_name: 'Someone',
    email: null,
    phone: null,
    role: 'cleaner',
    preferred_language: null,
    is_active: true,
    created_at: '2026-09-01T08:00:00+00:00',
    ...overrides,
  });

const maria = person({
  id: MARIA,
  full_name: 'Maria Test',
  email: 'maria@example.com',
  phone: '+420 777 111 222',
  preferred_language: 'cs',
});
const petr = person({ id: PETR, full_name: 'Petr Tech', email: 'petr@example.com', role: 'tech' });
const olga = person({
  id: OLGA,
  full_name: 'Olga Manager',
  email: 'olga@example.com',
  role: 'manager',
});
// Somebody who left: no login was ever made for her, and she is switched off.
const ivan = person({ id: IVAN, full_name: 'Ivan Gone', is_active: false });

const properties: Property[] = [
  { id: 1, name: 'Vinohrady 12' },
  { id: 2, name: 'Anděl 4' },
];
const links: CleanerLink[] = [
  { property_id: 1, cleaner_id: MARIA, mode: 'auto', priority: 1 },
  { property_id: 2, cleaner_id: MARIA, mode: 'claim', priority: 3 },
];

const NEW_PASSWORD = 'chilly-otter-42';

const saveStaff = vi.fn();
const saveLink = vi.fn();
const removeLink = vi.fn();
const resetPassword = vi.fn();
const idle = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };

vi.mock('../use-team', () => ({
  useStaff: () => ({ data: [maria, petr, olga, ivan], isPending: false, isError: false }),
  useProperties: () => ({ data: properties, isPending: false, isError: false }),
  useCleanerLinks: () => ({ data: links, isPending: false, isError: false }),
  useSaveStaff: () => ({ ...idle, mutate: saveStaff }),
  useResetPassword: () => ({ ...idle, mutate: resetPassword }),
  useSaveCleanerLink: () => ({ ...idle, mutate: saveLink }),
  useRemoveCleanerLink: () => ({ ...idle, mutate: removeLink }),
}));

import { TeamView } from '../team-view';

/** The row a person is on — the table is read by name, as the manager reads it. */
const rowFor = (name: string): HTMLElement =>
  screen.getAllByRole('row').find((row) => row.textContent?.includes(name)) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  resetPassword.mockImplementation((id: string, options?: { onSuccess?: (a: unknown) => void }) => {
    options?.onSuccess?.({ id, password: NEW_PASSWORD, emailSent: true });
  });
});

describe('TeamView', () => {
  test('opens on the people who are working, and counts every tab', () => {
    render(<TeamView />);

    expect(screen.getByRole('tab', { name: /Работают/ })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /Отключённые/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Все/ })).toHaveTextContent('4');

    expect(rowFor('Maria Test')).toBeInTheDocument();
    expect(screen.queryByText('Ivan Gone')).not.toBeInTheDocument();
  });

  test('keeps somebody who left, and says on their row that they do not work here', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('tab', { name: /Отключённые/ }));

    expect(within(rowFor('Ivan Gone')).getByText('Не работает')).toBeInTheDocument();
  });

  test('shows the login, and the language the letters go out in', () => {
    render(<TeamView />);

    const row = rowFor('Maria Test');
    expect(within(row).getByText('maria@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Čeština')).toBeInTheDocument();
    // Nobody chose one for Petr, and that is not the same as English.
    expect(within(rowFor('Petr Tech')).getByText('Не выбран')).toBeInTheDocument();
  });

  test('filters by role', async () => {
    render(<TeamView />);

    await userEvent.selectOptions(screen.getByLabelText('Роль'), 'Техник');

    expect(screen.getByText('Petr Tech')).toBeInTheDocument();
    expect(screen.queryByText('Maria Test')).not.toBeInTheDocument();
    // The count follows the filter, so it cannot disagree with the list under it.
    expect(screen.getByRole('tab', { name: /Работают/ })).toHaveTextContent('1');
  });

  test('finds a person by the phone number a missed call left', async () => {
    render(<TeamView />);

    await userEvent.type(screen.getByLabelText('Имя, почта или телефон'), '777 111');

    expect(screen.getByText('Maria Test')).toBeInTheDocument();
    expect(screen.queryByText('Petr Tech')).not.toBeInTheDocument();
  });

  test('says nobody was found rather than that the company is empty', async () => {
    render(<TeamView />);

    await userEvent.type(screen.getByLabelText('Имя, почта или телефон'), 'никого такого');

    expect(screen.getByText('Никого не нашлось.')).toBeInTheDocument();
  });

  test('counts listings for the people who work them, and offers none to a manager', () => {
    render(<TeamView />);

    expect(
      within(rowFor('Maria Test')).getByRole('button', { name: 'Объектов: 2' }),
    ).toBeInTheDocument();
    expect(
      within(rowFor('Olga Manager')).queryByRole('button', { name: /Объектов/ }),
    ).not.toBeInTheDocument();
  });

  test('shows a fresh password once, with the login it belongs to', async () => {
    render(<TeamView />);

    await userEvent.click(
      within(rowFor('Maria Test')).getByRole('button', { name: 'Сбросить пароль' }),
    );

    expect(resetPassword).toHaveBeenCalledWith(MARIA, expect.anything());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Пароль для Maria Test')).toBeInTheDocument();
    expect(within(dialog).getByText(NEW_PASSWORD)).toBeInTheDocument();
    expect(within(dialog).getByText('maria@example.com')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Письмо с логином и паролем отправлено на maria@example.com.'),
    ).toBeInTheDocument();
  });

  test('cannot reset a password for somebody who never had a login', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('tab', { name: /Отключённые/ }));

    expect(
      within(rowFor('Ivan Gone')).getByRole('button', { name: 'Сбросить пароль' }),
    ).toBeDisabled();
  });

  test('opens an edit with the login locked, because moving it is an auth matter', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Изменить сотрудника')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Почта (логин)')).toBeDisabled();
    expect(within(dialog).getByLabelText('Имя')).toHaveValue('Maria Test');
    // Hiring somebody switched off is not a thing; switching somebody off is.
    expect(within(dialog).getByLabelText('Работает')).toBeChecked();
  });

  test('asks for an address when the person is new, and sends the draft on', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText('Почта (логин)')).toBeEnabled();
    expect(within(dialog).queryByLabelText('Работает')).not.toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Имя'), 'Nova Cleaner');
    await userEvent.type(within(dialog).getByLabelText('Почта (логин)'), 'nova@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    expect(saveStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        id: null,
        fullName: 'Nova Cleaner',
        email: 'nova@example.com',
        role: 'cleaner',
      }),
      expect.anything(),
    );
  }, 20000);

  test('will not create a person with no name or no address', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Имя'), 'Nova Cleaner');
    expect(within(dialog).getByRole('button', { name: 'Создать' })).toBeDisabled();
  }, 20000);

  test('lists the listings a person works, the fixed ones first', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Объектов: 2' }));

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Объекты: Maria Test')).toBeInTheDocument();
    const names = within(sheet)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(names[0]).toContain('Vinohrady 12');
    expect(names[1]).toContain('Anděl 4');
  });

  test('takes somebody off a listing', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Объектов: 2' }));
    const sheet = await screen.findByRole('dialog');
    const [first] = within(sheet).getAllByRole('listitem');

    await userEvent.click(within(first).getByRole('button', { name: 'Убрать' }));

    expect(removeLink).toHaveBeenCalledWith({ propertyId: 1, cleanerId: MARIA });
  });
});
