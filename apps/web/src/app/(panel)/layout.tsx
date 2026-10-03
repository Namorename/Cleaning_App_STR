import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

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
    <div className="flex min-h-full flex-1">
      <Sidebar email={user?.email ?? ''} isInitiallyCollapsed={sidebar === 'collapsed'} />
      <main className="min-h-0 min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
