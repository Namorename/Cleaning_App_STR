import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { forgetThisPhone } from '@/features/push/api';
import { isNetworkError } from '@/lib/online';
import { sessionStorage } from '@/lib/secure-storage';
import { SESSION_STORAGE_KEY, supabase } from '@/lib/supabase';

interface SessionState {
  session: Session | null;
  userId: string | null;
  /** True until the stored session has been read from the Keychain. */
  isLoading: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

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
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (isMounted) {
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
 */
export async function signOut(): Promise<void> {
  await forgetThisPhone();
  const { error } = await supabase.auth.signOut();
  if (error === null) {
    return;
  }
  if (!isNetworkError(error) || (await sessionStorage.getItem(SESSION_STORAGE_KEY)) !== null) {
    throw error;
  }
}
