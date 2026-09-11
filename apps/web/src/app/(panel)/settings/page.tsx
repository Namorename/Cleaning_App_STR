import { SettingsView } from '@/features/settings/settings-view';
import { createClient } from '@/lib/supabase/server';

import { signOut } from '../../(auth)/login/actions';

/**
 * Stage 6 in outline: the account, and the way out of it.
 *
 * A server component because the address and the sign-out action both belong
 * to the server; everything the reader sees is rendered by the client half,
 * which is where the translations live.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <SettingsView email={user?.email ?? ''} onSignOut={signOut} />;
}
