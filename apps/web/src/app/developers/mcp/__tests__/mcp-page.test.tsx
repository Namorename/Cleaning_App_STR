import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import McpPage, { generateMetadata } from '../page';

/** vitest.setup.ts: the project the panel runs against in the tests. */
const MCP_URL = 'https://project.supabase.co/functions/v1/mcp';

async function renderPage(lang?: string): Promise<void> {
  render(await McpPage({ searchParams: Promise.resolve(lang === undefined ? {} : { lang }) }));
}

describe('the MCP server page', () => {
  test('speaks English by default and names its tab in the address’s language', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'MCP server' })).toBeInTheDocument();
    expect((await generateMetadata({ searchParams: Promise.resolve({}) })).title).toBe(
      'woom MCP server',
    );
    expect((await generateMetadata({ searchParams: Promise.resolve({ lang: 'ru' }) })).title).toBe(
      'MCP-сервер woom',
    );
  });

  test('gives the server’s address for this deployment, and the clients’ settings with it', async () => {
    await renderPage();

    const endpoint = screen.getByRole('region', { name: 'Address' });
    expect(within(endpoint).getByText(MCP_URL)).toBeInTheDocument();
    const clients = screen.getByRole('region', { name: 'Connecting' });
    for (const client of ['Claude Code', 'Cursor', 'Claude Desktop', 'claude.ai']) {
      expect(within(clients).getByRole('heading', { level: 3, name: client })).toBeInTheDocument();
    }
    const [signIn, withKey] = within(clients).getAllByText(/claude mcp add --transport http woom/);
    expect(signIn).toHaveTextContent(`claude mcp add --transport http woom ${MCP_URL}`);
    expect(signIn).not.toHaveTextContent('Authorization');
    expect(withKey).toHaveTextContent(MCP_URL);
    expect(withKey).toHaveTextContent('Bearer $WOOM_API_KEY');
    expect(within(clients).getByText(/\$\{env:WOOM_API_KEY\}/)).toHaveTextContent(MCP_URL);
  });

  test('holds no key: the settings name a variable or a placeholder', async () => {
    await renderPage();

    expect(document.body.textContent ?? '').not.toMatch(/woom_[A-Za-z0-9_-]{20,}/);
    expect(screen.getByText(/<your key>/)).toBeInTheDocument();
  });

  test('warns what the key allows, before anything else is said of it', async () => {
    await renderPage();

    const note = screen.getByRole('note');
    expect(note).toHaveTextContent('An assistant can do everything its connection or its key allows');
    expect(note).toHaveTextContent('«Read only»');
  });

  test('tells the Claude apps to connect through Connectors and sign in, with no key', async () => {
    await renderPage();

    const clients = screen.getByRole('region', { name: 'Connecting' });
    expect(within(clients).getByText(/add a custom connector with the address above/)).toBeInTheDocument();
    expect(within(clients).getByText(/sign in as a company admin/)).toBeInTheDocument();
  });

  test('lists every tool with its scope, and marks the three that change data', async () => {
    await renderPage();

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(17);
    expect(rows.filter((row) => within(row).queryByText('Changes data') !== null)).toHaveLength(3);
    const me = rows.find((row) => within(row).queryByText('get_me') !== null);
    expect(me).toHaveTextContent('Any key');
    const assign = rows.find((row) => within(row).queryByText('assign_cleaning') !== null);
    expect(assign).toHaveTextContent('cleanings:assign');
  });

  test('in Russian, the scopes read as the key form says them', async () => {
    await renderPage('ru');

    expect(screen.getByRole('heading', { level: 1, name: 'MCP-сервер' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    // list_cleanings and get_cleaning, both under «cleanings:read».
    expect(within(table).getAllByText('Чтение уборок')).toHaveLength(2);
    expect(within(table).getAllByText('Меняет данные')).toHaveLength(3);
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'ru');
  });

  test('offers the other two languages, and the API reference', async () => {
    await renderPage('cs');

    const languages = screen.getByRole('navigation', { name: 'Další jazyky' });
    expect(
      within(languages)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/developers/mcp?lang=en', '/developers/mcp?lang=ru']);
    expect(screen.getByRole('link', { name: 'Reference API' })).toHaveAttribute(
      'href',
      '/developers',
    );
  });
});
