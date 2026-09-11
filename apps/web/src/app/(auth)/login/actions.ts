'use server';

import { redirect } from 'next/navigation';

import { safeNext } from '@/lib/safe-next';
import { isPanelRole, roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export type SignInIssue = 'invalid' | 'notManager' | 'missing';

export interface SignInState {
  issue: SignInIssue | null;
  /**
   * The address that was typed, handed back so the form can keep it.
   *
   * React clears an uncontrolled form once the action returns, and a wrong
   * password would otherwise cost the address as well — the one field the
   * person got right. The password is never sent back: retyping it is the point.
   */
  email: string;
}

/**
 * Email and password in, a session cookie out.
 *
 * A cleaner's credentials are valid for Auth but not for this panel: the
 * session is dropped again at once, so the cookie never carries a token the
 * panel would refuse on every page.
 */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = formData.get('email');
  const password = formData.get('password');
  const typed = typeof email === 'string' ? email : '';
  if (typeof email !== 'string' || typeof password !== 'string' || email === '' || password === '') {
    return { issue: 'missing', email: typed };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || data.user === null) {
    return { issue: 'invalid', email: typed };
  }

  if (!isPanelRole(roleOf(data.user))) {
    await supabase.auth.signOut();
    return { issue: 'notManager', email: typed };
  }

  redirect(safeNext(formData.get('next')));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
