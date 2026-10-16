import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Article, ArticleRow, Place, Revision } from '../schema';

// The router reads the address jsdom holds; the view writes it through history.
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

const ARTICLE_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const OLD_ID = '22222222-2222-4222-8222-222222222222';
const BOSS = '44444444-4444-4444-8444-444444444444';

const places: Place[] = [
  { id: 1, name: 'Flat one', parent_id: null, hostaway_unit_id: null, status: 'active' },
  { id: 10, name: 'The house', parent_id: null, hostaway_unit_id: null, status: 'active' },
  { id: 11, name: 'Room one', parent_id: 10, hostaway_unit_id: 66011, status: 'active' },
];

const row = (patch: Partial<ArticleRow>): ArticleRow => ({
  id: ARTICLE_ID,
  status: 'published',
  scope: 'building',
  language: 'ru',
  title: 'Котёл',
  rev: 4,
  updated_at: '2026-10-17T08:00:00Z',
  targets: [{ property_id: 10 }],
  translations: [{ language: 'en' }],
  ...patch,
});

const rows: ArticleRow[] = [
  row({}),
  row({ id: DRAFT_ID, status: 'draft', scope: 'company', title: 'Правила', targets: [], translations: [] }),
  row({ id: OLD_ID, status: 'archived', scope: 'properties', title: 'Старое', targets: [{ property_id: 1 }] }),
];

const article: Article = {
  ...row({}),
  body: 'В коридоре.',
  translations: [{ language: 'en', title: 'Boiler', body: 'In the hall.' }],
};

const revisions: Revision[] = [
  { rev: 4, language: 'ru', title: 'Котёл', body: 'В коридоре.', translations: {}, edited_by: BOSS, created_at: '2026-10-17T08:00:00Z' },
  { rev: 1, language: 'ru', title: 'Котёл', body: 'Где-то.', translations: {}, edited_by: BOSS, created_at: '2026-10-16T08:00:00Z' },
];

const state = {
  article: article as Article | null,
};
const saveArticle = vi.fn();
const setStatus = vi.fn();
const restore = vi.fn();
const done = { isPending: false, isError: false, error: null };

vi.mock('../use-knowledge', () => ({
  useArticles: () => ({ ...done, data: rows }),
  useArticle: (id: string | null) =>
    id === null ? { ...done, data: undefined } : { ...done, data: state.article },
  usePlaces: () => ({ ...done, data: places }),
  useRevisions: () => ({ ...done, data: revisions }),
  usePeople: () => ({ ...done, data: [{ id: BOSS, full_name: 'Boss' }] }),
  useSaveArticle: () => ({ isPending: false, mutateAsync: saveArticle }),
  useSetArticleStatus: () => ({ isPending: false, mutateAsync: setStatus }),
  useRestoreRevision: () => ({ isPending: false, mutateAsync: restore }),
}));

import { KnowledgeView } from '../knowledge-view';

function renderView() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <KnowledgeView />
    </QueryClientProvider>,
  );
}

const titles = () =>
  screen.queryAllByRole('row').slice(1).map((one) => within(one).getAllByRole('cell')[0].textContent);

beforeEach(() => {
  window.history.replaceState(null, '', '/knowledge');
  state.article = article;
  saveArticle.mockReset().mockResolvedValue({ id: ARTICLE_ID, rev: 5, status: 'published' });
  setStatus.mockReset().mockResolvedValue({ id: ARTICLE_ID, rev: 5, status: 'draft' });
  restore.mockReset().mockResolvedValue({ id: ARTICLE_ID, rev: 5, status: 'published' });
});

describe('the list', () => {
  test('shows drafts and published, the archive kept out of the way', () => {
    renderView();

    expect(screen.getByRole('heading', { level: 1, name: 'База знаний' })).toBeInTheDocument();
    expect(titles()).toEqual(['Котёл', 'Правила']);
    const first = screen.getAllByRole('row')[1];
    expect(within(first).getByText('Опубликована')).toBeInTheDocument();
    expect(within(first).getByText('The house')).toBeInTheDocument();
    expect(within(first).getByText('RU')).toBeInTheDocument();
    expect(within(first).getByText('EN')).toBeInTheDocument();
  });

  test('narrows by status, and the status goes into the address', async () => {
    renderView();

    await userEvent.selectOptions(screen.getByLabelText('Статус'), 'archived');

    expect(titles()).toEqual(['Старое']);
    expect(window.location.search).toBe('?status=archived');
  });

  test('narrows by place: a room shows the articles of its house', async () => {
    renderView();

    await userEvent.selectOptions(screen.getByLabelText('Место'), 'The house — Room one');

    expect(titles()).toEqual(['Котёл']);
  });

  test('narrows to the whole company’s', async () => {
    renderView();

    await userEvent.selectOptions(screen.getByLabelText('Место'), 'Вся компания');

    expect(titles()).toEqual(['Правила']);
  });
});

describe('a new article', () => {
  test('opens the editor with the warning about codes in three languages, the panel’s first', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: 'Новая статья' }));

    const warning = screen.getByRole('note', { name: 'Никаких кодов доступа в статьях' });
    const lines = within(warning).getAllByRole('listitem');
    expect(lines.map((line) => line.getAttribute('lang'))).toEqual(['ru', 'en', 'cs']);
    expect(lines[0]).toHaveTextContent('Не пишите сюда коды доступа');
    expect(lines[1]).toHaveTextContent('Never write access codes here');
    expect(lines[2]).toHaveTextContent('Nepište sem přístupové kódy');
  });

  test('is written in the panel’s language for the whole company, and saved under its new id', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Новая статья' }));

    await userEvent.type(screen.getByLabelText('Заголовок'), 'Пылесос');
    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'В шкафу.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(saveArticle).toHaveBeenCalledTimes(1);
    const [{ draft, expectedRev }] = saveArticle.mock.calls[0];
    expect(expectedRev).toBeNull();
    expect(draft).toMatchObject({
      language: 'ru',
      title: 'Пылесос',
      body: 'В шкафу.',
      scope: 'company',
      propertyIds: [],
    });
    await waitFor(() => expect(window.location.search).toBe(`?article=${draft.id}`));
  });

  test('a translation typed in its tab is part of the draft', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Новая статья' }));
    await userEvent.type(screen.getByLabelText('Заголовок'), 'Пылесос');

    await userEvent.click(screen.getByRole('tab', { name: /Английский/ }));
    await userEvent.type(screen.getByLabelText('Заголовок'), 'Vacuum cleaner');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(saveArticle.mock.calls[0][0].draft.translations).toEqual({
      en: { title: 'Vacuum cleaner', body: '' },
    });
  });
});

describe('the preview', () => {
  test('draws the marks as the phone will, and HTML as text', async () => {
    renderView();
    await userEvent.click(screen.getByRole('button', { name: 'Новая статья' }));

    fireEvent.change(screen.getByLabelText('Текст'), {
      target: {
        value: 'Жми **сильно**.\n\n1) Открой кран.\n2) Закрой.\n\n> Не трогай котёл.\n\n<script>alert(1)</script>',
      },
    });

    const preview = screen.getByRole('region', { name: 'Предпросмотр: как в телефоне' });
    expect(within(preview).getByText('сильно').tagName).toBe('STRONG');
    expect(within(preview).getByText('Шаг 1')).toBeInTheDocument();
    expect(within(preview).getByText('Шаг 2')).toBeInTheDocument();
    expect(within(preview).getByRole('note')).toHaveTextContent('ВажноНе трогай котёл.');
    expect(within(preview).getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(preview.querySelector('script')).toBeNull();
  });
});

describe('an article that is out', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', `/knowledge?article=${ARTICLE_ID}`);
  });

  test('taken back from the phones after an edit: saved first, from the version shown', async () => {
    renderView();

    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'В подвале.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Снять с публикации' }));

    expect(saveArticle).toHaveBeenCalledTimes(1);
    expect(saveArticle.mock.calls[0][0].expectedRev).toBe(4);
    expect(saveArticle.mock.calls[0][0].draft.body).toBe('В подвале.');
    expect(setStatus).toHaveBeenCalledWith({ id: ARTICLE_ID, status: 'draft' });
    expect(saveArticle.mock.invocationCallOrder[0]).toBeLessThan(
      setStatus.mock.invocationCallOrder[0],
    );
  });

  test('archived as it is, with nothing to save first', async () => {
    renderView();

    await userEvent.click(screen.getByRole('button', { name: 'В архив' }));

    expect(saveArticle).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith({ id: ARTICLE_ID, status: 'archived' });
  });

  test('a save from an older screen says so, and offers the latest version', async () => {
    saveArticle.mockRejectedValue({
      message: 'Article is at version 5, the screen showed 4',
      hint: 'serverErrors.kbArticleChanged',
      details: '{"rev":5}',
      code: '23514',
    });
    renderView();

    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'В подвале.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Статью тем временем сохранил кто-то другой',
    );
    expect(screen.getByRole('button', { name: 'Загрузить последнюю версию' })).toBeInTheDocument();
  });

  test('brings an older version back, but not over unsaved changes', async () => {
    renderView();

    const restoreOne = screen.getByRole('button', { name: 'Вернуть версию 1' });
    await userEvent.click(restoreOne);
    expect(restore).toHaveBeenCalledWith({ id: ARTICLE_ID, rev: 1, expectedRev: 4 });

    fireEvent.change(screen.getByLabelText('Текст'), { target: { value: 'Правка' } });
    expect(screen.getByRole('button', { name: 'Вернуть версию 1' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Вернуть версию 4' })).not.toBeInTheDocument();
  });

  test('a place the writer does not see is kept through her edit', async () => {
    state.article = { ...article, scope: 'properties', targets: [{ property_id: 1 }, { property_id: 999 }] };
    renderView();

    expect(screen.getByText('Места вне вашего доступа, останутся как есть: 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'The house' }));
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect([...saveArticle.mock.calls[0][0].draft.propertyIds].sort((a, b) => a - b)).toEqual([
      1, 10, 999,
    ]);
  });
});
