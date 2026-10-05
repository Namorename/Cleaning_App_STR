import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { PageBackLink, PageHeader } from './page-header';

const SRC = path.resolve(__dirname, '..');

/** Every component file of the panel, tests aside. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.tsx') && !entry.name.includes('.test.') ? [full] : [];
  });
}

describe('PageHeader', () => {
  test('names the page in its one h1, with the description under it', () => {
    render(<PageHeader title="Уборки" description="Объектов: 5 · комнат: 2" />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Уборки' })).toBeInTheDocument();
    expect(screen.getByText('Объектов: 5 · комнат: 2')).toBeInTheDocument();
  });

  test('puts the page’s actions in the header, beside its title', () => {
    render(
      <PageHeader
        title="Команда"
        actions={<button type="button">Добавить сотрудника</button>}
      />,
    );
    const header = screen.getByRole('heading', { level: 1 }).closest('[data-slot="page-header"]');

    expect(header).not.toBeNull();
    expect(header).toContainElement(screen.getByRole('button', { name: 'Добавить сотрудника' }));
  });

  test('keeps what describes the title — a status, a count — next to it', () => {
    render(<PageHeader title="Течёт кран" meta={<span>Новое</span>} />);

    expect(screen.getByRole('heading', { level: 1 }).parentElement).toContainElement(
      screen.getByText('Новое'),
    );
  });

  test('leads back to the list above the title, its arrow out of the reader’s way', () => {
    render(<PageHeader title="Vinohrady 12" back={{ href: '/apartments', label: 'Все объекты' }} />);
    const back = screen.getByRole('link', { name: 'Все объекты' });

    expect(back).toHaveAttribute('href', '/apartments');
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(
      back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('draws nothing it was not given', () => {
    const { container } = render(<PageHeader title="Дашборд" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="page-actions"]')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  test('a back link alone is the same link, for a page that has not loaded its title yet', () => {
    render(<PageBackLink href="/problems" label="К списку заданий" />);

    expect(screen.getByRole('link', { name: 'К списку заданий' })).toHaveAttribute(
      'href',
      '/problems',
    );
  });
});

/**
 * docs/redesign-plan.md §2.4: the panel had ten copies of its page heading.
 * One component writes it now, so a page cannot grow a second h1 or lose its
 * place for actions by drifting from the others.
 */
describe('the panel’s pages', () => {
  test('take their h1 from the common header and write none of their own', () => {
    const writers = sourceFiles(SRC)
      .filter((file) => /<h1[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'));

    expect(writers).toEqual(['components/page-header.tsx']);
  });
});
