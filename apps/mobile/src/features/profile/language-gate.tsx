import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import { useSession } from '@/features/auth/session';
import { applyLanguage, deviceLanguage } from '@/i18n';

import { fetchMyLanguage } from './api';
import { profileKeys } from './keys';

/** A language is chosen about never; asking once an hour is generous. */
const FRESH_FOR_MS = 60 * 60 * 1000;

interface ProfileLanguageGateProps {
  children: ReactNode;
}

/**
 * Makes the app speak the language the manager chose for this person.
 *
 * Before anyone signs in there is no profile to ask, so the device locale
 * stands — that is what `i18n` starts with. Once the session has a user, her
 * own row decides, and on sign-out the device takes over again, so the next
 * person on a shared phone starts from her own phone's language rather than
 * from her colleague's.
 *
 * Nothing below this component has to know. `applyLanguage` emits i18next's
 * `languageChanged`, every component that shows translated text is subscribed
 * through `useTranslation`, and the whole tree redraws itself — including the
 * navigation headers, which are built in components that subscribe too.
 *
 * The switch happens in an effect, never during render: `changeLanguage` fires
 * its event synchronously, and a render that re-renders other components is
 * the one thing React will not forgive.
 */
export function ProfileLanguageGate({ children }: ProfileLanguageGateProps) {
  const { userId } = useSession();

  const profile = useQuery({
    queryKey: profileKeys.language(userId ?? 'nobody'),
    queryFn: () => fetchMyLanguage(userId ?? ''),
    enabled: userId !== null,
    staleTime: FRESH_FOR_MS,
  });

  const chosen = profile.data?.preferred_language ?? null;

  useEffect(() => {
    void applyLanguage(userId === null || chosen === null ? deviceLanguage() : chosen);
  }, [chosen, userId]);

  return <>{children}</>;
}
