'use server';

import { redirect } from 'next/navigation';

import { isPanelRole, roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

export type SignInIssue = 'invalid' | 'notManager' | 'missing';

export interface SignInState {
  issue: SignInIssue | null;
}

function safeNext(value: FormDataEntryValue | null): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/dashboard';
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
  if (typeof email !== 'string' || typeof password !== 'string' || email === '' || password === '') {
    return { issue: 'missing' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || data.user === null) {
    return { issue: 'invalid' };
  }

  if (!isPanelRole(roleOf(data.user))) {
    await supabase.auth.signOut();
    return { issue: 'notManager' };
  }

  redirect(safeNext(formData.get('next')));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
