import { ApartmentsView } from '@/features/apartments/apartments-view';
import { roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

/**
 * Stage 5: the registry of listings. The data is the client's to fetch; the role is read here,
 * from app_metadata: the sync by hand is not the reception's (owner, 2026-11-19).
 */
export default async function ApartmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <ApartmentsView canSync={roleOf(user) !== 'reception'} />;
}
