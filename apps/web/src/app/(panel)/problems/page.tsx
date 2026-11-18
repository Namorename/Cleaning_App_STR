import { ProblemsSection } from '@/features/boards/problems-section';
import { roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

/**
 * «Задания»: the technicians' board and the list (stage 1), and the manager
 * boards beside them (owner, 2026-11-18). The data is the client's to fetch;
 * who reads the page is read here, from app_metadata, because only a board's
 * owner and an admin change it — the database refuses anybody else either way.
 */
export default async function ProblemsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <ProblemsSection viewer={{ id: user?.id ?? '', isAdmin: roleOf(user) === 'admin' }} />;
}
