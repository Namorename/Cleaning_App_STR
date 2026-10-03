import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { MobileNav } from '@/components/mobile-nav';
import { Sidebar } from '@/components/sidebar';
import { isPanelRole, roleOf } from '@/lib/session';
import { SIDEBAR_COOKIE, sidebarFromCookie } from '@/lib/sidebar-state';
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
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isPanelRole(roleOf(user))) {
    redirect('/login');
  }

  const sidebar = sidebarFromCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <MobileNav email={user?.email ?? ''} />
      <Sidebar email={user?.email ?? ''} isInitiallyCollapsed={sidebar === 'collapsed'} />
      <main className="min-h-0 min-w-0 flex-1 p-4 [--page-chrome:5.5rem] md:p-6 md:[--page-chrome:3rem]">
        {children}
      </main>
    </div>
  );
}
