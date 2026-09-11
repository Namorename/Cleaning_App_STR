'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  fetchCleanerLinks,
  fetchProperties,
  fetchStaff,
  removeCleanerLink,
  resetStaffPassword,
  saveCleanerLink,
  saveStaff,
  type LinkInput,
} from './api';
import { teamKeys } from './keys';
import type { StaffDraft } from './schema';

export function useStaff() {
  const client = useSupabase();
  return useQuery({ queryKey: teamKeys.staff(), queryFn: () => fetchStaff(client) });
}

export function useProperties() {
  const client = useSupabase();
  return useQuery({ queryKey: teamKeys.properties(), queryFn: () => fetchProperties(client) });
}

export function useCleanerLinks() {
  const client = useSupabase();
  return useQuery({ queryKey: teamKeys.links(), queryFn: () => fetchCleanerLinks(client) });
}

/**
 * After any write the whole section is stale together.
 *
 * A role change moves somebody between the tabs and can take their listings
 * out of reach; a link change moves the count on the row. Invalidating the
 * branch keeps the two lists from disagreeing on screen.
 */
function useInvalidateTeam() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: teamKeys.all });
}

export function useSaveStaff() {
  const client = useSupabase();
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (draft: StaffDraft) => saveStaff(client, draft),
    onSuccess: invalidate,
  });
}

export function useResetPassword() {
  const client = useSupabase();
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (id: string) => resetStaffPassword(client, id),
    onSuccess: invalidate,
  });
}

export function useSaveCleanerLink() {
  const client = useSupabase();
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: (link: LinkInput) => saveCleanerLink(client, link),
    onSuccess: invalidate,
  });
}

export function useRemoveCleanerLink() {
  const client = useSupabase();
  const invalidate = useInvalidateTeam();
  return useMutation({
    mutationFn: ({ propertyId, cleanerId }: { propertyId: number; cleanerId: string }) =>
      removeCleanerLink(client, propertyId, cleanerId),
    onSuccess: invalidate,
  });
}
