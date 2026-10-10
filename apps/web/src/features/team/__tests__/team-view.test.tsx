import { render, screen, waitFor, within } from '@testing-library/react';
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
// A cleaner on no listing yet: her drawer offers the whole catalogue.
const NINA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005';
const nina = person({ id: NINA, full_name: 'Nina Free', email: 'nina@example.com' });
const GLEB = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000006';
const gleb = person({
  id: GLEB,
  full_name: 'Gleb Head',
  email: 'gleb@example.com',
  role: 'head_tech',
});
// A role a later migration may add: the panel does not know it.
const ZOE = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000007';
const zoe = person({
  id: ZOE,
  full_name: 'Zoe Unknown',
  email: 'zoe@example.com',
  role: 'inspector',
});

/** Who the section lists; a test that needs more people adds them. */
const roster = { people: [maria, petr, olga, ivan, nina] };

const properties: Property[] = [
  { id: 1, name: 'Vinohrady 12' },
  { id: 2, name: 'Anděl 4' },
];
const MARIA_LINKS: CleanerLink[] = [
  { property_id: 1, cleaner_id: MARIA, mode: 'auto', priority: 1 },
  { property_id: 2, cleaner_id: MARIA, mode: 'claim', priority: 3 },
];
/** Every link in the company; a test that needs more adds them. */
const linkSet = { all: MARIA_LINKS };

const NEW_PASSWORD = 'chilly-otter-42';

const saveStaff = vi.fn();
const saveLink = vi.fn();
const removeLink = vi.fn();
const resetPassword = vi.fn();
/** The form writes links one at a time and waits for each; the drawer fires and forgets. */
const saveLinkAsync = vi.fn();
const removeLinkAsync = vi.fn();
const idle = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };
/** How the last save of a person ended, as the form reads it from the mutation. */
const staffSave = { isError: false, error: null as unknown };

vi.mock('../use-team', () => ({
  useStaff: () => ({ data: roster.people, isPending: false, isError: false }),
  useProperties: () => ({ data: properties, isPending: false, isError: false }),
  useCleanerLinks: () => ({ data: linkSet.all, isPending: false, isError: false }),
  useSaveStaff: () => ({ ...idle, ...staffSave, mutate: saveStaff }),
  useResetPassword: () => ({ ...idle, mutate: resetPassword }),
  useSaveCleanerLink: () => ({ ...idle, mutate: saveLink, mutateAsync: saveLinkAsync }),
  useRemoveCleanerLink: () => ({ ...idle, mutate: removeLink, mutateAsync: removeLinkAsync }),
}));

import { expectPageTitle } from '@/components/page-header.expect';
import { ServerRefusal } from '@/lib/function-error';

import { TeamView } from '../team-view';

/** The row a person is on — the table is read by name, as the manager reads it. */
const rowFor = (name: string): HTMLElement =>
  screen.getAllByRole('row').find((row) => row.textContent?.includes(name)) as HTMLElement;

/** The question before an edit that cannot be undone, answered «Сохранить». */
const confirmSave = async (name: string) => {
  const question = await screen.findByRole('dialog', { name: `Сохранить изменения для ${name}?` });
  await userEvent.click(within(question).getByRole('button', { name: 'Сохранить' }));
};

const NEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000009';

beforeEach(() => {
  vi.clearAllMocks();
  roster.people = [maria, petr, olga, ivan, nina];
  linkSet.all = MARIA_LINKS;
  staffSave.isError = false;
  staffSave.error = null;
  resetPassword.mockImplementation((id: string, options?: { onSuccess?: (a: unknown) => void }) => {
    options?.onSuccess?.({ id, password: NEW_PASSWORD, emailSent: true });
  });
  saveStaff.mockImplementation(
    (draft: { id: string | null }, options?: { onSuccess?: (a: unknown) => void }) => {
      // A new account answers with a password; an edit does not.
      options?.onSuccess?.(
        draft.id === null
          ? { id: NEW_ID, password: NEW_PASSWORD, emailSent: true }
          : { id: draft.id },
      );
    },
  );
  saveLinkAsync.mockResolvedValue(undefined);
  removeLinkAsync.mockResolvedValue(undefined);
});

describe('TeamView', () => {
  test('is headed by the common header', () => {
    render(<TeamView />);

    expectPageTitle('Команда');
  });

  test('opens on the people who are working, and counts every tab', () => {
    render(<TeamView />);

    expect(screen.getByRole('tab', { name: /Работают/ })).toHaveTextContent('4');
    expect(screen.getByRole('tab', { name: /Отключённые/ })).toHaveTextContent('1');
    expect(screen.getByRole('tab', { name: /Все/ })).toHaveTextContent('5');

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
    const question = await screen.findByRole('dialog', {
      name: 'Сбросить пароль для Maria Test?',
    });
    await userEvent.click(within(question).getByRole('button', { name: 'Сбросить пароль' }));

    expect(resetPassword).toHaveBeenCalledWith(MARIA, expect.anything());
    const dialog = await screen.findByRole('dialog', { name: 'Пароль для Maria Test' });
    expect(within(dialog).getByText('Пароль для Maria Test')).toBeInTheDocument();
    expect(within(dialog).getByText(NEW_PASSWORD)).toBeInTheDocument();
    expect(within(dialog).getByText('maria@example.com')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Письмо с логином и паролем отправлено на maria@example.com.'),
    ).toBeInTheDocument();
  });

  // The owner, 09.10: one press used to set a new password, and the old one
  // stopped working before anybody was asked.
  describe('a reset asks first', () => {
    const askFor = async (name: string) => {
      const row = within(rowFor(name)).getByRole('button', { name: 'Сбросить пароль' });
      await userEvent.click(row);
      const question = await screen.findByRole('dialog', {
        name: `Сбросить пароль для ${name}?`,
      });
      return { row, question };
    };

    test('names the person, and sends nothing yet', async () => {
      render(<TeamView />);

      const { question } = await askFor('Maria Test');

      expect(question).toHaveAccessibleDescription(
        'Старый пароль сразу перестанет работать. Новый появится на следующем экране.',
      );
      expect(resetPassword).not.toHaveBeenCalled();
    });

    test('opens with the focus on «Отмена»', async () => {
      render(<TeamView />);

      const { question } = await askFor('Maria Test');

      await waitFor(() =>
        expect(within(question).getByRole('button', { name: 'Отмена' })).toHaveFocus(),
      );
    });

    test('«Отмена» closes it with nothing changed, and the focus goes back to the row', async () => {
      render(<TeamView />);
      const { row, question } = await askFor('Maria Test');

      await userEvent.click(within(question).getByRole('button', { name: 'Отмена' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(resetPassword).not.toHaveBeenCalled();
      await waitFor(() => expect(row).toHaveFocus());
    });

    test('Escape closes it with nothing changed', async () => {
      render(<TeamView />);
      await askFor('Maria Test');

      await userEvent.keyboard('{Escape}');

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(resetPassword).not.toHaveBeenCalled();
    });

    test('the answer «Сбросить пароль» resets once, for that person', async () => {
      render(<TeamView />);
      const { question } = await askFor('Petr Tech');

      await userEvent.click(within(question).getByRole('button', { name: 'Сбросить пароль' }));

      expect(resetPassword).toHaveBeenCalledTimes(1);
      expect(resetPassword).toHaveBeenCalledWith(PETR, expect.anything());
      expect(
        await screen.findByRole('dialog', { name: 'Пароль для Petr Tech' }),
      ).toBeInTheDocument();
    });
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

    // Each row's button says which listing it takes her off.
    await userEvent.click(within(first).getByRole('button', { name: 'Убрать: Vinohrady 12' }));
    const question = await screen.findByRole('dialog', {
      name: 'Maria Test: убрать объект «Vinohrady 12»?',
    });
    await userEvent.click(within(question).getByRole('button', { name: 'Убрать' }));

    expect(removeLink).toHaveBeenCalledWith({ propertyId: 1, cleanerId: MARIA });
  });
});

describe('TeamView — listings are chosen while the person is hired', () => {
  test('a listing ticked on the form is opened as the account is made', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText('Имя'), 'Nova Cleaner');
    await userEvent.type(within(dialog).getByLabelText('Почта (логин)'), 'nova@example.com');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Vinohrady 12' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    // The id comes from the account that was just made, not from the list.
    await waitFor(() =>
      expect(saveLinkAsync).toHaveBeenCalledWith({
        propertyId: 1,
        cleanerId: NEW_ID,
        mode: 'claim',
        priority: 1,
      }),
    );
  }, 20000);

  test('a manager is not offered listings — she is not put on them', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Менеджер');

    expect(within(dialog).queryByRole('checkbox', { name: 'Vinohrady 12' })).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('Менеджеру и администратору объекты не назначаются — им видно всё.'),
    ).toBeInTheDocument();
  }, 20000);

  test('an edit opens with the listings the person already works ticked', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByRole('checkbox', { name: 'Vinohrady 12' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Anděl 4' })).toBeChecked();
  });

  test('unticking a listing closes it, and the untouched one is not rewritten', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Anděl 4' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await confirmSave('Maria Test');

    await waitFor(() =>
      expect(removeLinkAsync).toHaveBeenCalledWith({ propertyId: 2, cleanerId: MARIA }),
    );
    // Vinohrady 12 stayed ticked, so nothing was written for it — the terms
    // the drawer set on that link survive an edit of the person.
    expect(saveLinkAsync).not.toHaveBeenCalled();
  }, 20000);

  test('several listings are ticked and opened by one press', async () => {
    render(<TeamView />);

    // Nina is on nothing, so the whole catalogue is on offer in her drawer.
    await userEvent.click(within(rowFor('Nina Free')).getByRole('button', { name: 'Объектов: 0' }));
    const sheet = await screen.findByRole('dialog');

    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Vinohrady 12' }));
    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Anděl 4' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(saveLinkAsync).toHaveBeenCalledTimes(2));
    expect(saveLinkAsync).toHaveBeenCalledWith({
      propertyId: 1,
      cleanerId: NINA,
      mode: 'claim',
      priority: 1,
    });
    expect(saveLinkAsync).toHaveBeenCalledWith({
      propertyId: 2,
      cleanerId: NINA,
      mode: 'claim',
      priority: 1,
    });
  }, 20000);

  test('after a failed write only what is still closed stays ticked, and nothing is written twice', async () => {
    // Vinohrady 12 opens, Anděl 4 is refused.
    saveLinkAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
    render(<TeamView />);

    await userEvent.click(within(rowFor('Nina Free')).getByRole('button', { name: 'Объектов: 0' }));
    const sheet = await screen.findByRole('dialog');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Выбрать все (2)' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(within(sheet).getByText('Выбрано: 1')).toBeInTheDocument());
    expect(within(sheet).getByRole('checkbox', { name: 'Anděl 4' })).toBeChecked();
    expect(within(sheet).getByRole('checkbox', { name: 'Vinohrady 12' })).not.toBeChecked();

    // Pressed again, it writes only what is still closed — not the open one
    // again over terms the manager may have set on its row since.
    saveLinkAsync.mockClear();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(saveLinkAsync).toHaveBeenCalledTimes(1));
    expect(saveLinkAsync).toHaveBeenCalledWith({
      propertyId: 2,
      cleanerId: NINA,
      mode: 'claim',
      priority: 1,
    });
  }, 20000);

  test('the list of listings can be searched', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Nina Free')).getByRole('button', { name: 'Объектов: 0' }));
    const sheet = await screen.findByRole('dialog');

    await userEvent.type(within(sheet).getByLabelText('Поиск по названию'), 'vino');

    expect(within(sheet).getByRole('checkbox', { name: 'Vinohrady 12' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('checkbox', { name: 'Anděl 4' })).not.toBeInTheDocument();

    await userEvent.clear(within(sheet).getByLabelText('Поиск по названию'));
    expect(within(sheet).getByRole('checkbox', { name: 'Anděl 4' })).toBeInTheDocument();
  }, 20000);

  test('a search that matches nothing says so', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Nina Free')).getByRole('button', { name: 'Объектов: 0' }));
    const sheet = await screen.findByRole('dialog');

    await userEvent.type(within(sheet).getByLabelText('Поиск по названию'), 'улица которой нет');

    expect(within(sheet).getByText('Ничего не найдено')).toBeInTheDocument();
  }, 20000);

  test('a listing ticked and then searched out of sight is still opened', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Nina Free')).getByRole('button', { name: 'Объектов: 0' }));
    const sheet = await screen.findByRole('dialog');

    await userEvent.click(within(sheet).getByRole('checkbox', { name: 'Anděl 4' }));
    // The search hides rows; it does not untick them.
    await userEvent.type(within(sheet).getByLabelText('Поиск по названию'), 'vino');
    expect(within(sheet).getByText('Выбрано: 1')).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole('button', { name: 'Добавить' }));

    await waitFor(() =>
      expect(saveLinkAsync).toHaveBeenCalledWith({
        propertyId: 2,
        cleanerId: NINA,
        mode: 'claim',
        priority: 1,
      }),
    );
  }, 20000);

  test('nothing ticked, nothing to press', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Nina Free')).getByRole('button', { name: 'Объектов: 0' }));
    const sheet = await screen.findByRole('dialog');

    expect(within(sheet).getByRole('button', { name: 'Добавить' })).toBeDisabled();
  });

  test('a person already on every listing is told so, not shown an empty box', async () => {
    render(<TeamView />);

    // Maria holds both listings in the fixture.
    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Объектов: 2' }));
    const sheet = await screen.findByRole('dialog');

    expect(within(sheet).getByText('Все объекты уже открыты.')).toBeInTheDocument();
  });

  test('saving an edit that changed no listing writes none', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(within(dialog).getByLabelText('Телефон'), '+420 000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(saveStaff).toHaveBeenCalled());
    expect(saveLinkAsync).not.toHaveBeenCalled();
    expect(removeLinkAsync).not.toHaveBeenCalled();
  }, 20000);
});

describe('TeamView — the technician and the head technician (docs/tech-plan.md, 3 and 4)', () => {
  test('the list shows the head technician by her role', () => {
    roster.people = [...roster.people, gleb];
    render(<TeamView />);

    expect(within(rowFor('Gleb Head')).getByTitle('Главный техник')).toBeInTheDocument();
  });

  test('the role filter finds the head technician', async () => {
    roster.people = [...roster.people, gleb];
    render(<TeamView />);

    await userEvent.selectOptions(screen.getByLabelText('Роль'), 'Главный техник');

    expect(screen.getByText('Gleb Head')).toBeInTheDocument();
    expect(screen.queryByText('Petr Tech')).not.toBeInTheDocument();
  });

  test('the form offers the head technician, and sends the role as chosen', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Имя'), 'Gleb Head');
    await userEvent.type(within(dialog).getByLabelText('Почта (логин)'), 'gleb@example.com');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Главный техник');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    expect(saveStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: null, role: 'head_tech' }),
      expect.anything(),
    );
    // Nothing to open: no listing goes with the role.
    await waitFor(() => expect(screen.getByText(NEW_PASSWORD)).toBeInTheDocument());
    expect(saveLinkAsync).not.toHaveBeenCalled();
  }, 20000);

  test.each(['Техник', 'Главный техник'])(
    'a %s is offered no listings, and is told why',
    async (role) => {
      render(<TeamView />);

      await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), role);

      expect(
        within(dialog).queryByRole('checkbox', { name: 'Vinohrady 12' }),
      ).not.toBeInTheDocument();
      expect(
        // A technician's job is «работа» (CLAUDE.md); «Задания» are the reports.
        within(dialog).getByText(
          'Технику и главному технику объекты не назначаются: уборки — не их работа, работа приходит назначением.',
        ),
      ).toBeInTheDocument();
    },
    20000,
  );

  test('the row of a technician has no listings to count', () => {
    roster.people = [...roster.people, gleb];
    render(<TeamView />);

    expect(
      within(rowFor('Petr Tech')).queryByRole('button', { name: /Объектов/ }),
    ).not.toBeInTheDocument();
    expect(
      within(rowFor('Gleb Head')).queryByRole('button', { name: /Объектов/ }),
    ).not.toBeInTheDocument();
  });
});

describe('TeamView — a role the panel does not know (docs/tech-plan.md, 3.5)', () => {
  beforeEach(() => {
    roster.people = [...roster.people, zoe];
  });

  test('is not shown as a cleaner, nor counted as one', async () => {
    render(<TeamView />);

    expect(within(rowFor('Zoe Unknown')).getByTitle('Сотрудник')).toBeInTheDocument();
    expect(within(rowFor('Zoe Unknown')).queryByTitle('Горничная')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Роль'), 'Горничная');
    expect(screen.queryByText('Zoe Unknown')).not.toBeInTheDocument();
  });

  test('opens the form with no role chosen, and the form will not save it', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Zoe Unknown')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText('Роль')).toHaveValue('');
    expect(
      within(dialog).getByRole('option', { name: 'Роль неизвестна', selected: true }),
    ).toBeInTheDocument();
    expect(
      // The role chosen is not added to the one the panel cannot read: it replaces it.
      within(dialog).getByText(
        'Панель не знает роль этого сотрудника. Чтобы сохранить, выберите роль из списка — она заменит нынешнюю.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Телефон'), '+420 000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    expect(saveStaff).not.toHaveBeenCalled();
  }, 20000);

  test('saves once a role is chosen on purpose', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Zoe Unknown')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Техник');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));

    expect(saveStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: ZOE, role: 'tech' }),
      expect.anything(),
    );
  }, 20000);

  test('Enter in a field does not save it either', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Zoe Unknown')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Телефон'), '+420 000{Enter}');

    expect(saveStaff).not.toHaveBeenCalled();
  }, 20000);
});

describe('TeamView — a technician’s old listings (docs/tech-plan.md, 2.1)', () => {
  /** A link from before the technician rule: the server lets it be taken off, and nothing else. */
  const petrOldLink: CleanerLink = { property_id: 2, cleaner_id: PETR, mode: 'claim', priority: 1 };

  test('a technician who still holds a listing has the button, to take it off', () => {
    linkSet.all = [...MARIA_LINKS, petrOldLink];
    render(<TeamView />);

    // The one way to his old links: a 48 px target (design decision 5).
    expect(within(rowFor('Petr Tech')).getByRole('button', { name: 'Объектов: 1' })).toHaveClass(
      'min-h-12',
    );
    // A manager on no listing still has nothing to count.
    expect(
      within(rowFor('Olga Manager')).queryByRole('button', { name: /Объектов/ }),
    ).not.toBeInTheDocument();
  });

  test('his editor lists the listing and offers only to take it off', async () => {
    linkSet.all = [...MARIA_LINKS, petrOldLink];
    render(<TeamView />);

    await userEvent.click(within(rowFor('Petr Tech')).getByRole('button', { name: 'Объектов: 1' }));
    const sheet = await screen.findByRole('dialog');

    const [row] = within(sheet).getAllByRole('listitem');
    expect(row).toHaveTextContent('Anděl 4');
    expect(row).toHaveTextContent('Из очереди');
    // The server refuses any change of the terms: there is nothing to change here.
    expect(within(sheet).queryByLabelText('Как достаётся: Anděl 4')).toBeNull();
    expect(within(sheet).queryByLabelText('Очередь: Anděl 4')).toBeNull();
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Добавить' })).toBeNull();
    expect(
      within(sheet).getByText('Этой роли объекты не назначаются: привязки можно только убрать.'),
    ).toBeInTheDocument();

    // The row's only action: named after the listing, and a 48 px target.
    const remove = within(row).getByRole('button', { name: 'Убрать: Anděl 4' });
    expect(remove).toHaveClass('min-h-12');
    await userEvent.click(remove);
    const question = await screen.findByRole('dialog', {
      name: 'Petr Tech: убрать объект «Anděl 4»?',
    });
    // His role is put on no listing: what the question warns of is that it is final.
    expect(question).toHaveAccessibleDescription(
      'Вернуть эту привязку будет нельзя: этой роли объекты не назначаются.',
    );
    await userEvent.click(within(question).getByRole('button', { name: 'Убрать' }));

    expect(removeLink).toHaveBeenCalledWith({ propertyId: 2, cleanerId: PETR });
  });

  test('a cleaner made a technician is told how many listings to take off first', async () => {
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Техник');

    // It says what is taken off — the links, not the person — and where:
    // the form stands over the row whose button opens them.
    const warning = within(dialog).getByText(
      'Ещё на 2 объектах. Сначала уберите эти привязки: кнопка «Объектов: 2» в строке сотрудника.',
    );
    expect(within(dialog).getByLabelText('Роль')).toHaveAccessibleDescription(
      warning.textContent ?? '',
    );

    // Chosen back, she is a cleaner with her listings again: nothing to warn of.
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Горничная');
    expect(within(dialog).queryByText(/Сначала уберите/)).toBeNull();
  }, 20000);

  test('a single listing is counted in the singular, and a head technician is warned too', async () => {
    linkSet.all = [MARIA_LINKS[0]];
    render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Главный техник');

    expect(
      within(dialog).getByText(
        'Ещё на 1 объекте. Сначала уберите эту привязку: кнопка «Объектов: 1» в строке сотрудника.',
      ),
    ).toBeInTheDocument();
  }, 20000);

  // 20261003110000 refuses any change into a technician's role while links
  // remain — from one technician's role to the other's too, not only from a cleaner's.
  test('a technician with an old listing made head technician is warned', async () => {
    linkSet.all = [...MARIA_LINKS, petrOldLink];
    render(<TeamView />);

    await userEvent.click(within(rowFor('Petr Tech')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Главный техник');

    expect(within(dialog).getByText(/^Ещё на 1 объекте/)).toBeInTheDocument();
  }, 20000);

  test('a manager with a listing from her cleaning days made a technician is warned', async () => {
    linkSet.all = [...MARIA_LINKS, { property_id: 1, cleaner_id: OLGA, mode: 'auto', priority: 1 }];
    render(<TeamView />);

    await userEvent.click(within(rowFor('Olga Manager')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Техник');

    expect(within(dialog).getByText(/^Ещё на 1 объекте/)).toBeInTheDocument();
  }, 20000);

  // 20261003110000 asks only a change into the role: an edit that keeps it is an edit.
  test('a technician already, his phone corrected, is not warned of his old listing', async () => {
    linkSet.all = [...MARIA_LINKS, petrOldLink];
    render(<TeamView />);

    await userEvent.click(within(rowFor('Petr Tech')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByText(/Сначала уберите/)).toBeNull();
  }, 20000);

  test('a cleaner with listings ticked and then made a technician opens no listing', async () => {
    render(<TeamView />);

    await userEvent.click(screen.getByRole('button', { name: 'Добавить сотрудника' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Имя'), 'Nova Tech');
    await userEvent.type(within(dialog).getByLabelText('Почта (логин)'), 'nova@example.com');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Vinohrady 12' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Техник');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать' }));

    expect(saveStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: null, role: 'tech' }),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText(NEW_PASSWORD)).toBeInTheDocument());
    expect(saveLinkAsync).not.toHaveBeenCalled();
  }, 20000);

  test('a cleaner with listings made a technician anyway: the role is sent, no listing is closed, the refusal is read out', async () => {
    saveStaff.mockImplementation(() => {
      staffSave.isError = true;
      staffSave.error = new ServerRefusal(
        'Person still holds 2 listing links and 0 open cleanings',
        'serverErrors.techRoleBlocked',
        JSON.stringify({ links: 2, cleanings: 0 }),
      );
    });
    const { rerender } = render(<TeamView />);

    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Изменить' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Роль'), 'Техник');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await confirmSave('Maria Test');
    // The mutation's new state reaching the form, as TanStack's re-render would.
    rerender(<TeamView />);

    expect(saveStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: MARIA, role: 'tech' }),
      expect.anything(),
    );
    expect(removeLinkAsync).not.toHaveBeenCalled();
    expect(saveLinkAsync).not.toHaveBeenCalled();
    const alert = within(dialog)
      .getAllByRole('alert')
      .find((one) => one.textContent?.includes('Сначала снимите сотрудника'));
    expect(alert).toHaveTextContent(
      'Сначала снимите сотрудника с объектов (привязок: 2) и с открытых уборок (0): у техника уборок не бывает.',
    );
    expect(alert).not.toHaveTextContent('Person still holds');
  }, 20000);
});

// The owner, 10.10: switching an account off, a new role and taking a person off
// a listing cannot be undone by the panel — each used to happen on one press.
describe('TeamView — what cannot be undone asks first', () => {
  const openEdit = async (name: string) => {
    await userEvent.click(within(rowFor(name)).getByRole('button', { name: 'Изменить' }));
    return screen.findByRole('dialog');
  };

  test('switching an account off names the person, says what goes, and sends nothing yet', async () => {
    render(<TeamView />);
    const form = await openEdit('Maria Test');

    await userEvent.click(within(form).getByRole('checkbox', { name: 'Работает' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    const question = await screen.findByRole('dialog', {
      name: 'Сохранить изменения для Maria Test?',
    });
    expect(question).toHaveTextContent(
      'Учётка отключится: ещё не начатые уборки и работы освободятся, привязки к объектам снимутся. Если включить её снова, они не вернутся.',
    );
    expect(saveStaff).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(within(question).getByRole('button', { name: 'Отмена' })).toHaveFocus(),
    );
  }, 20000);

  test('«Отмена» leaves the form open with the draft, and nothing is sent', async () => {
    render(<TeamView />);
    const form = await openEdit('Maria Test');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Работает' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    const question = await screen.findByRole('dialog', {
      name: 'Сохранить изменения для Maria Test?',
    });

    await userEvent.click(within(question).getByRole('button', { name: 'Отмена' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Сохранить изменения для Maria Test?' }),
      ).not.toBeInTheDocument(),
    );
    // The form itself is still open, with the draft and the focus back on «Сохранить».
    const still = screen.getByRole('dialog', { name: 'Изменить сотрудника' });
    expect(still).toBeInTheDocument();
    expect(within(still).getByRole('checkbox', { name: 'Работает' })).not.toBeChecked();
    await waitFor(() =>
      expect(within(still).getByRole('button', { name: 'Сохранить' })).toHaveFocus(),
    );
    expect(saveStaff).not.toHaveBeenCalled();
  }, 20000);

  test('Escape closes only the question; the form stays and nothing is sent', async () => {
    render(<TeamView />);
    const form = await openEdit('Maria Test');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Работает' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));
    await screen.findByRole('dialog', { name: 'Сохранить изменения для Maria Test?' });

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Сохранить изменения для Maria Test?' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Изменить сотрудника' })).toBeInTheDocument();
    expect(saveStaff).not.toHaveBeenCalled();
  }, 20000);

  test('the answer «Сохранить» switches the account off, once', async () => {
    render(<TeamView />);
    const form = await openEdit('Maria Test');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Работает' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    await confirmSave('Maria Test');

    await waitFor(() => expect(saveStaff).toHaveBeenCalledTimes(1));
    expect(saveStaff).toHaveBeenCalledWith(
      expect.objectContaining({ id: MARIA, isActive: false }),
      expect.anything(),
    );
  }, 20000);

  test('a new role says from which to which before it is sent', async () => {
    render(<TeamView />);
    const form = await openEdit('Petr Tech');
    await userEvent.selectOptions(within(form).getByLabelText('Роль'), 'Главный техник');
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    const question = await screen.findByRole('dialog', {
      name: 'Сохранить изменения для Petr Tech?',
    });
    expect(question).toHaveTextContent('Роль сменится: «Техник» → «Главный техник».');
    expect(saveStaff).not.toHaveBeenCalled();

    await confirmSave('Petr Tech');

    await waitFor(() =>
      expect(saveStaff).toHaveBeenCalledWith(
        expect.objectContaining({ id: PETR, role: 'head_tech' }),
        expect.anything(),
      ),
    );
  }, 20000);

  test('a listing unticked on the form is counted in the question', async () => {
    render(<TeamView />);
    const form = await openEdit('Maria Test');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Anděl 4' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    const question = await screen.findByRole('dialog', {
      name: 'Сохранить изменения для Maria Test?',
    });
    expect(question).toHaveTextContent('Снимутся привязки к объектам: 1.');
    expect(removeLinkAsync).not.toHaveBeenCalled();
  }, 20000);

  test('switching somebody back on, or a new phone, asks nothing', async () => {
    roster.people = [maria, ivan];
    render(<TeamView />);
    await userEvent.click(screen.getByRole('tab', { name: /Все/ }));
    const form = await openEdit('Ivan Gone');

    await userEvent.click(within(form).getByRole('checkbox', { name: 'Работает' }));
    await userEvent.type(within(form).getByLabelText('Телефон'), '+420 000');
    await userEvent.click(within(form).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(saveStaff).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: /Сохранить изменения/ })).not.toBeInTheDocument();
  }, 20000);

  test('«Убрать» names the person and the listing, opens on «Отмена», and takes nothing off yet', async () => {
    render(<TeamView />);
    await userEvent.click(within(rowFor('Maria Test')).getByRole('button', { name: 'Объектов: 2' }));
    const sheet = await screen.findByRole('dialog');

    await userEvent.click(within(sheet).getByRole('button', { name: 'Убрать: Anděl 4' }));

    const question = await screen.findByRole('dialog', {
      name: 'Maria Test: убрать объект «Anděl 4»?',
    });
    expect(question).toHaveAccessibleDescription(
      'Свободные уборки этого объекта перестанут быть видны в приложении и не будут назначаться сами. Уже назначенные уборки останутся как есть.',
    );
    await waitFor(() =>
      expect(within(question).getByRole('button', { name: 'Отмена' })).toHaveFocus(),
    );
    expect(removeLink).not.toHaveBeenCalled();

    await userEvent.click(within(question).getByRole('button', { name: 'Отмена' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Maria Test: убрать объект «Anděl 4»?' }),
      ).not.toBeInTheDocument(),
    );
    // The sheet stays, with the listing still on it.
    const still = screen.getByRole('dialog', { name: 'Объекты: Maria Test' });
    expect(within(still).getByRole('button', { name: 'Убрать: Anděl 4' })).toBeInTheDocument();
    expect(removeLink).not.toHaveBeenCalled();
  }, 20000);
});
