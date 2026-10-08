'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { problemKeys } from '@/features/problems/keys';
import { taskKeys } from '@/features/tasks/keys';
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

/**
 * Switching somebody off takes her off every job nobody has started, on the
 * server (20261004100000, docs/staff-disable-plan.md): the cleanings, the
 * calendar, the tasks and the dashboard the panel holds are stale with it.
 */
function useInvalidateWork() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: taskKeys.all }),
      queryClient.invalidateQueries({ queryKey: problemKeys.all }),
    ]);
}

/**
 * Refreshed however it ends: manage-staff writes the profile row before
 * app_metadata, and when the second write fails the row is already changed.
 * A person saved switched off refreshes the jobs too.
 */
export function useSaveStaff() {
  const client = useSupabase();
  const invalidate = useInvalidateTeam();
  const invalidateWork = useInvalidateWork();
  return useMutation({
    mutationFn: (draft: StaffDraft) => saveStaff(client, draft),
    onSettled: (_data, _error, draft) =>
      Promise.all([invalidate(), draft.id !== null && !draft.isActive ? invalidateWork() : null]),
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
