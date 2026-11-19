import { GuestSignalsView } from '@/features/guest-signals/guest-signals-view';
import { roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

/**
 * «Гости» (docs/guest-signals.md §7.2). The data is the client's to fetch;
 * the role is read here, from app_metadata, because the switches are the
 * admin's — the database refuses a manager either way.
 */
export default async function GuestsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const role = roleOf(user);
  // «Настройки» of guests are the company's levers: not the reception's (owner, 2026-11-19).
  return <GuestSignalsView isAdmin={role === 'admin'} hasSettings={role !== 'reception'} />;
}
