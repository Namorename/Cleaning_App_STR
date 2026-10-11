import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearThisPhone, releaseThisPhone } from '@/features/push/api';
import { flushPendingRelease, keepThisPhonePending } from '@/features/push/pending-release';
import { registerThisPhone } from '@/features/push/registration';
import {
  beginSignOut,
  endSignOut,
  registrant,
  unmarkRegistered,
} from '@/features/push/token-store';
import { applyWordContext } from '@/i18n';
import { isNetworkError } from '@/lib/online';
import { reportUnlessOffline } from '@/lib/sentry';
import { sessionStorage } from '@/lib/secure-storage';
import { SESSION_STORAGE_KEY, supabase } from '@/lib/supabase';

import { knownRole, roleOf, wordContextOf } from './role';

interface SessionState {
  session: Session | null;
  userId: string | null;
  /** True until the stored session has been read from the Keychain. */
  isLoading: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * The words of the person a session belongs to (`applyWordContext`), applied
 * before the session reaches any screen: a technician's first draw already
 * says «работа». Nobody signed in reads the key itself.
 */
function applyWordsOf(session: Session | null): void {
  applyWordContext(wordContextOf(knownRole(roleOf(session?.user ?? null))));
}

interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) {
        return;
      }
      applyWordsOf(data.session);
      setSession(data.session);
      setIsLoading(false);
    });

    // A refreshed token carries a role the office changed meanwhile.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (isMounted) {
        applyWordsOf(next);
        setSession(next);
      }
    });

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<SessionState>(
    () => ({ session, userId: session?.user.id ?? null, isLoading }),
    [session, isLoading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession was called outside SessionProvider');
  }
  return value;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
}

/**
 * Leaves the account. The phone's push token is let go of first, while the
 * call still runs as her — afterwards the server would refuse it — so pushes
 * about her stop reaching a phone she may be handing on.
 *
 * Without signal auth-js usually removes the session all the same and only
 * reports the network: then she is out, and nothing failed. With an access
 * token that expired while the app slept it cannot refresh, keeps the session
 * and returns the same error — so what decides is whether a session is still
 * stored, not what the error says.
 *
 * The phone forgets the token only once she is out (docs/f11-native-review.md,
 * Т-2): a failed sign-out keeps it for the next try to let go of, and one that
 * failed after the server already let go registers the phone for her again —
 * she is still here, and pushes would otherwise stop without a word.
 */
export async function signOut(): Promise<void> {
  const person = registrant();
  // The session ends during this call: its own let-go is this one, not the
  // listener's (pending-release.ts, letGoAfterSessionEnded).
  beginSignOut();
  try {
    const release = await releaseThisPhone();
    const { error } = await supabase.auth.signOut();
    const isOut =
      error === null ||
      (isNetworkError(error) && (await sessionStorage.getItem(SESSION_STORAGE_KEY)) === null);
    if (isOut) {
      // A let-go the server did not hear waits to be sent again, with no
      // session, before the phone forgets its token (owner's word of
      // 2026-10-11, 00:40).
      // A Keychain that refuses does not undo a sign-out that happened
      // (review of 86122ac); the send is not waited for — she is out.
      if (release === 'unconfirmed') {
        await keepThisPhonePending().catch(() => undefined);
      }
      await clearThisPhone();
      void flushPendingRelease();
      return;
    }
    if (release === 'released') {
      unmarkRegistered();
      if (person !== null) {
        registerThisPhone(person).catch(reportUnlessOffline);
      }
    }
    throw error;
  } finally {
    endSignOut();
  }
}
