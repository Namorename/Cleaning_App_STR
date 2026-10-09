'use client';

import type { Language } from '@str-ops/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { teamKeys } from '@/features/team/keys';
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
 * The signed-in person's language, written on her profile. «Команда» lists
 * everybody's language, hers included, so its list is read again.
 */
export function useSaveMyLanguage() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, language }: { userId: string; language: Language }) =>
      saveMyLanguage(client, userId, language),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: teamKeys.all }),
  });
}
