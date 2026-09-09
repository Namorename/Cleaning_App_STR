import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Sidebar } from '@/components/sidebar';
import { isPanelRole, roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

import { signOut } from '../(auth)/login/actions';

/**
 * The shell every manager page sits in.
 *
 * Checks the role a second time, after the proxy: a page rendered on the
 * server must not depend on a request filter it cannot see.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isPanelRole(roleOf(user))) {
    redirect('/login');
  }

  return (
    <div className="flex min-h-full flex-1">
      <Sidebar email={user?.email ?? ''} onSignOut={signOut} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
