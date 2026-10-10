import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Who reaches the pages that hold the two ways to create work — «Новая уборка»
 * on «Уборки» and «Новое задание» on «Задания». Neither button asks for a
 * role: the shell decides who is let in, from `app_metadata` (CLAUDE.md), and
 * row level security decides what a write may do. The head technician works in
 * the phone (docs/tech-plan.md §10, answer 2: «Работает в телефоне»), so the
 * panel has no view for him.
 */
let signedIn: { email: string; app_metadata: Record<string, unknown> } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: signedIn } }) },
  }),
}));
const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
  }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

import { LanguageSync } from '@/components/language-sync';

import PanelLayout from '../(panel)/layout';

beforeEach(() => {
  redirect.mockClear();
  jar.clear();
});

/** Every element of a tree the layout returned, without rendering it. */
function elementsOf(node: unknown): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(node)) {
    return node.flatMap(elementsOf);
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    return [];
  }
  const element = node as { type: unknown; props: Record<string, unknown> };
  return [element, ...elementsOf(element.props.children)];
}

// The sign-in sets the cookie from the profile and moves on into the panel
// without a reload: the shell, rendered afresh with that cookie, is where the
// open page learns the language (components/language-sync.tsx).
describe('the panel’s language', () => {
  test('the shell hands the page the language of the cookie it was rendered with', async () => {
    signedIn = { email: 'office@test.local', app_metadata: { role: 'manager' } };
    jar.set('lang', 'cs');

    const shell = await PanelLayout({ children: null });

    const sync = elementsOf(shell).find((element) => element.type === LanguageSync);
    expect(sync?.props.language).toBe('cs');
  });

  test('no cookie is the panel’s default language', async () => {
    signedIn = { email: 'office@test.local', app_metadata: { role: 'admin' } };

    const shell = await PanelLayout({ children: null });

    const sync = elementsOf(shell).find((element) => element.type === LanguageSync);
    expect(sync?.props.language).toBe('ru');
  });
});

describe('the panel’s shell', () => {
  test.each(['manager', 'admin'])(
    'lets a %s in to the pages with both create buttons',
    async (role) => {
      signedIn = { email: 'office@test.local', app_metadata: { role } };

      await expect(PanelLayout({ children: null })).resolves.toBeTruthy();
      expect(redirect).not.toHaveBeenCalled();
    },
  );

  test.each(['cleaner', 'tech', 'head_tech'])('sends a %s to the sign-in', async (role) => {
    signedIn = { email: 'field@test.local', app_metadata: { role } };

    await expect(PanelLayout({ children: null })).rejects.toThrow('redirect:/login');
  });

  test('a role written by the client itself opens nothing', async () => {
    signedIn = { email: 'field@test.local', app_metadata: {} };

    await expect(PanelLayout({ children: null })).rejects.toThrow('redirect:/login');
  });
});
