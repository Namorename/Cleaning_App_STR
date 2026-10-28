import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ApiKey, CreatedKey, KeyDraft } from '../schema';

const KEY = `woom_${'A'.repeat(43)}`;

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'k-1',
    name: 'Weekly report',
    prefix: 'woom_AAAAAAA',
    preset: 'read_only',
    scopes: [],
    effectiveScopes: ['cleanings:read', 'tasks:read'],
    propertyIds: null,
    expiresAt: '2027-01-26T12:00:00Z',
    state: 'active',
    createdBy: 'a-1',
    createdAt: '2026-10-28T12:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

const listState = { data: [] as ApiKey[], isPending: false, isError: false, error: null as unknown };
const create = vi.fn();
const update = vi.fn();
const revoke = vi.fn();
const mutationState = { isPending: false, isError: false, error: null as unknown };

vi.mock('../use-api-keys', () => ({
  useApiKeys: () => listState,
  useCreateApiKey: () => ({ ...mutationState, mutate: create }),
  useUpdateApiKey: () => ({ ...mutationState, mutate: update }),
  useRevokeApiKey: () => ({ ...mutationState, mutate: revoke }),
}));

vi.mock('@/features/team/use-team', () => ({
  useProperties: () => ({
    data: [
      { id: 101, name: 'Main House' },
      { id: 102, name: 'Flat Two' },
    ],
    isPending: false,
  }),
}));

import { ApiKeysSection } from '../api-keys-section';

beforeEach(() => {
  vi.clearAllMocks();
  listState.data = [];
  listState.isPending = false;
  listState.isError = false;
});

describe('Settings → API: the list', () => {
  test('says when there is no key yet, and links to the documentation', () => {
    render(<ApiKeysSection />);

    expect(screen.getByText('Ключей пока нет.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Документация API' })).toHaveAttribute('href', '/developers');
  });

  test('a key shows its prefix, never more, its access and its state', () => {
    listState.data = [apiKey()];
    render(<ApiKeysSection />);

    const item = screen.getByRole('listitem');
    expect(within(item).getByText('woom_AAAAAAA…')).toBeInTheDocument();
    expect(within(item).getByText('Действует')).toBeInTheDocument();
    expect(within(item).getByText(/Только чтение/)).toBeInTheDocument();
    expect(within(item).getByText('Все объекты')).toBeInTheDocument();
    expect(within(item).getByText('Ещё не использовался')).toBeInTheDocument();
  });

  test('a suspended key says why and what to do', () => {
    listState.data = [apiKey({ state: 'suspended' })];
    render(<ApiKeysSection />);

    expect(screen.getByText('Приостановлен')).toBeInTheDocument();
    expect(screen.getByText(/больше не активный админ/)).toBeInTheDocument();
  });

  test('a revoked key can be neither changed nor revoked again', () => {
    listState.data = [apiKey({ state: 'revoked', revokedAt: '2026-10-28T13:00:00Z' })];
    render(<ApiKeysSection />);

    expect(screen.queryByRole('button', { name: /Изменить/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Отозвать/ })).not.toBeInTheDocument();
  });

  test('revoking asks first, and sends nothing on «Отмена»', async () => {
    const user = userEvent.setup();
    listState.data = [apiKey()];
    render(<ApiKeysSection />);

    await user.click(screen.getByRole('button', { name: 'Отозвать: Weekly report' }));
    expect(screen.getByText('Отозвать ключ «Weekly report»?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(revoke).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Отозвать: Weekly report' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Отозвать' }));
    expect(revoke).toHaveBeenCalledWith('k-1');
  });
});

describe('Settings → API: a new key', () => {
  test('read only by default, 90 days, every property — and the key shown once', async () => {
    const user = userEvent.setup();
    create.mockImplementation((_draft: KeyDraft, options: { onSuccess: (created: CreatedKey) => void }) =>
      options.onSuccess({ key: KEY, api_key: apiKey() }),
    );
    render(<ApiKeysSection />);

    await user.click(screen.getByRole('button', { name: 'Создать ключ' }));
    await user.type(screen.getByLabelText('Название'), 'Weekly report');
    await user.click(screen.getAllByRole('button', { name: 'Создать ключ' }).at(-1) as HTMLElement);

    const draft = create.mock.calls[0][0] as KeyDraft;
    expect(draft).toMatchObject({ name: 'Weekly report', preset: 'read_only', scopes: [], expiresInDays: 90, restrict: false });

    expect(screen.getByText('Скопируйте ключ сейчас')).toBeInTheDocument();
    expect(screen.getByDisplayValue(KEY)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ключ сохранён' }));
    expect(screen.queryByDisplayValue(KEY)).not.toBeInTheDocument();
  });

  test('full access warns and waits for the name typed again', async () => {
    const user = userEvent.setup();
    render(<ApiKeysSection />);

    await user.click(screen.getByRole('button', { name: 'Создать ключ' }));
    await user.type(screen.getByLabelText('Название'), 'Agent');
    await user.click(screen.getByLabelText('Полный доступ'));

    expect(screen.getByText(/это как пароль админа/)).toBeInTheDocument();
    const save = screen.getAllByRole('button', { name: 'Создать ключ' }).at(-1) as HTMLElement;
    expect(save).toHaveAttribute('aria-disabled', 'true');

    await user.type(screen.getByLabelText(/Введите название ключа/), 'Agent');
    expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(save);
    expect(create.mock.calls[0][0]).toMatchObject({ preset: 'full', confirmation: 'Agent' });
  });

  test('read only fixes its reads and opens only the sensitive scopes to tick', async () => {
    const user = userEvent.setup();
    render(<ApiKeysSection />);
    await user.click(screen.getByRole('button', { name: 'Создать ключ' }));

    expect(screen.getByLabelText('Чтение уборок')).toBeChecked();
    expect(screen.getByLabelText('Чтение уборок')).toBeDisabled();
    expect(screen.getByLabelText('Назначение уборок')).not.toBeChecked();
    expect(screen.getByLabelText('Назначение уборок')).toBeDisabled();
    expect(screen.getByLabelText('Чтение имён сотрудников')).toBeEnabled();

    await user.click(screen.getByLabelText('Чтение имён сотрудников'));
    expect(screen.getByLabelText('Чтение имён сотрудников')).toBeChecked();
    expect(within(screen.getByRole('status', { name: '' })).getByText('Чтение имён сотрудников')).toBeInTheDocument();
  });

  test('custom starts from what the preset gave; the search hides rows, never unticks them', async () => {
    const user = userEvent.setup();
    render(<ApiKeysSection />);
    await user.click(screen.getByRole('button', { name: 'Создать ключ' }));
    await user.click(screen.getByLabelText('Свой набор'));

    expect(screen.getByLabelText('Чтение уборок')).toBeChecked();
    expect(screen.getByLabelText('Чтение уборок')).toBeEnabled();

    await user.type(screen.getByLabelText('Поиск по правам'), 'броней');
    expect(screen.queryByLabelText('Чтение уборок')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Чтение броней')).toBeChecked();

    await user.clear(screen.getByLabelText('Поиск по правам'));
    expect(screen.getByLabelText('Чтение уборок')).toBeChecked();
  });

  test('limited to properties: none ticked, nothing to save', async () => {
    const user = userEvent.setup();
    render(<ApiKeysSection />);
    await user.click(screen.getByRole('button', { name: 'Создать ключ' }));
    await user.type(screen.getByLabelText('Название'), 'House');
    await user.click(screen.getByLabelText('Только некоторые объекты'));

    const save = screen.getAllByRole('button', { name: 'Создать ключ' }).at(-1) as HTMLElement;
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByLabelText('Main House'));
    expect(save).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(save);
    expect(create.mock.calls[0][0]).toMatchObject({ restrict: true, propertyIds: [101] });
  });
});

describe('Settings → API: a change', () => {
  test('opens on the key as it is and says the change applies at once', async () => {
    const user = userEvent.setup();
    listState.data = [apiKey({ preset: 'operator', propertyIds: [102] })];
    render(<ApiKeysSection />);

    await user.click(screen.getByRole('button', { name: 'Изменить: Weekly report' }));
    expect(screen.getByText('Изменения действуют со следующего запроса ключа.')).toBeInTheDocument();
    expect(screen.getByLabelText('Оператор')).toBeChecked();
    expect(screen.getByLabelText('Только некоторые объекты')).toBeChecked();
    expect(screen.queryByLabelText('Срок действия')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(update).toHaveBeenCalledWith(
      { id: 'k-1', draft: expect.objectContaining({ preset: 'operator', propertyIds: [102], restrict: true }) },
      expect.anything(),
    );
  });
});
