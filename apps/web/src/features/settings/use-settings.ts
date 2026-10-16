'use client';

import type { Language } from '@str-ops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { teamKeys } from '@/features/team/keys';
import { applyLanguageChoice } from '@/lib/language';
import { useSupabase } from '@/lib/supabase/use-client';

import { fetchHostSettings, saveHostSettings, saveMyLanguage } from './api';
import { settingsKeys } from './keys';
import type { HostSettingsPatch } from './schema';

export function useHostSettings() {
  const client = useSupabase();
  return useQuery({ queryKey: settingsKeys.host(), queryFn: () => fetchHostSettings(client) });
}

/**
 * The save is reported done only once the company has been read again: the
 * returned promise holds the mutation pending until the refetch lands, so a
 * form that drops its draft on success shows the new numbers straight away,
 * never the old ones for a moment first.
 */
export function useSaveHostSettings() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: HostSettingsPatch) => saveHostSettings(client, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}

/**
 * The signed-in person's language, written on her profile; once the profile
 * has it, the panel changes — the cookie for the server's pages, <html lang>,
 * the dictionary, and a refresh for what the server renders.
 *
 * The change lives here, not in the switcher's own callback: a callback given
 * to `mutate` is dropped when its component leaves, and a manager who moves on
 * while the save is on its way would keep the old language over a profile that
 * already holds the new one. «Команда» lists everybody's language, hers
 * included, so its list is read again.
 */
export function useSaveMyLanguage() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { i18n } = useTranslation();
  return useMutation({
    mutationFn: ({ userId, language }: { userId: string; language: Language }) =>
      saveMyLanguage(client, userId, language),
    onSuccess: (_data, { language }) => {
      applyLanguageChoice(document, language);
      void i18n.changeLanguage(language);
      router.refresh();
      return queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
}
