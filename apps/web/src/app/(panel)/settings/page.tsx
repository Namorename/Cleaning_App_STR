import { cookies } from 'next/headers';

import { SettingsView } from '@/features/settings/settings-view';
import { createClient } from '@/lib/supabase/server';
import { THEME_COOKIE, themeFromCookie } from '@/lib/theme';

import { signOut } from '../../(auth)/login/actions';

/**
 * Stage 6 in outline: the account, and the way out of it.
 *
 * A server component because the address, the sign-out action and the theme
 * cookie all belong to the server; everything the reader sees is rendered by
 * the client half, which is where the translations live.
 */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const theme = themeFromCookie((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <SettingsView
      email={user?.email ?? ''}
      userId={user?.id ?? ''}
      theme={theme}
      onSignOut={signOut}
    />
  );
}
