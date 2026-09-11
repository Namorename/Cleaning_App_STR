'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { fetchHostSettings, saveHostSettings } from './api';
import { settingsKeys } from './keys';
import type { HostSettingsPatch } from './schema';

export function useHostSettings() {
  const client = useSupabase();
  return useQuery({ queryKey: settingsKeys.host(), queryFn: () => fetchHostSettings(client) });
}

export function useSaveHostSettings() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: HostSettingsPatch) => saveHostSettings(client, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.all });
    },
  });
}
