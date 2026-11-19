import { redirect } from 'next/navigation';

import { TeamView } from '@/features/team/team-view';
import { homeOf, panelAccessOf, roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Stage 4: the team. The data is the client's to fetch.
 *
 * A manager's and an admin's alone: the reception has no «Команда» (owner, 2026-11-19). The proxy
 * turns her away already; the page says it again, so an address the proxy reads otherwise does not
 * open it. manage-staff and row level security refuse her writes either way.
 */
export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = panelAccessOf(roleOf(user));
  if (access !== 'full') {
    redirect(access === null ? '/login' : homeOf(access));
  }

  return <TeamView />;
}
