import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { LanguageSync } from '@/components/language-sync';
import { MobileNav } from '@/components/mobile-nav';
import { Sidebar } from '@/components/sidebar';
import { LANGUAGE_COOKIE, languageFromCookie } from '@/lib/language';
import { isPanelRole, roleOf } from '@/lib/session';
import { SIDEBAR_COOKIE, sidebarFromCookie } from '@/lib/sidebar-state';
import { THEME_COOKIE, themeFromCookie } from '@/lib/theme';
import { createClient } from '@/lib/supabase/server';

/**
 * The shell every manager page sits in.
 *
 * Checks the role a second time, after the proxy: a page rendered on the
 * server must not depend on a request filter it cannot see. Reads the menu's
 * width from its cookie, so the first paint has the menu as it was left.
 *
 * Below `md` (768 px — a phone, a tablet upright) the side menu gives way to
 * the top bar and its sheet (the owner's decision 14), and the page takes the
 * whole width. `--page-chrome` is what the shell takes of the window's height
 * — the bar and the page's padding — for a screen that fills the rest (the
 * calendar).
 *
 * Reads the language cookie too: entered from the sign-in without a reload,
 * the page learns the language the profile set there (`LanguageSync`).
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isPanelRole(roleOf(user))) {
    redirect('/login');
  }

  const cookieStore = await cookies();
  const sidebar = sidebarFromCookie(cookieStore.get(SIDEBAR_COOKIE)?.value);
  const language = languageFromCookie(cookieStore.get(LANGUAGE_COOKIE)?.value);
  const theme = themeFromCookie(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <LanguageSync language={language} />
      <MobileNav email={user?.email ?? ''} theme={theme} />
      <Sidebar
        email={user?.email ?? ''}
        isInitiallyCollapsed={sidebar === 'collapsed'}
        theme={theme}
      />
      <main className="min-h-0 min-w-0 flex-1 p-4 [--page-chrome:5.5rem] md:p-6 md:[--page-chrome:3rem]">
        {children}
      </main>
    </div>
  );
}
