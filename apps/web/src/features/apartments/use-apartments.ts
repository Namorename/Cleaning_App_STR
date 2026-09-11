'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { taskKeys } from '@/features/tasks/keys';
import { teamKeys } from '@/features/team/keys';
import { useSupabase } from '@/lib/supabase/use-client';

import {
  copyChecklist,
  fetchChecklist,
  fetchChecklistOwner,
  fetchMaintenanceTasks,
  fetchOpenCleanings,
  fetchProperty,
  fetchPropertyProblems,
  fetchRegistry,
  fetchReservations,
  saveChecklist,
  savePropertyInfo,
  setPropertyStatus,
  syncListings,
  type StatusChange,
} from './api';
import { apartmentKeys } from './keys';
import type { ChecklistModule, InfoDraft } from './schema';

export function useRegistry() {
  const client = useSupabase();
  return useQuery({ queryKey: apartmentKeys.registry(), queryFn: () => fetchRegistry(client) });
}

export function useOpenCleanings() {
  const client = useSupabase();
  return useQuery({
    queryKey: apartmentKeys.openCleanings(),
    queryFn: () => fetchOpenCleanings(client),
  });
}

/**
 * A listing changing state is felt outside the registry.
 *
 * Taking one out of service cancels cleanings and removes it from every
 * picker; putting it back adds it again. The task and team branches are
 * invalidated with this one so a screen left open in another tab does not go
 * on offering a listing that has just been archived.
 */
function useInvalidateEverywhere() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: apartmentKeys.all });
    void queryClient.invalidateQueries({ queryKey: taskKeys.all });
    void queryClient.invalidateQueries({ queryKey: teamKeys.all });
  };
}

export function useSetStatus() {
  const client = useSupabase();
  const invalidate = useInvalidateEverywhere();
  return useMutation({
    mutationFn: (change: StatusChange) => setPropertyStatus(client, change),
    onSuccess: invalidate,
  });
}

export function useSyncListings() {
  const client = useSupabase();
  const invalidate = useInvalidateEverywhere();
  return useMutation({ mutationFn: () => syncListings(client), onSuccess: invalidate });
}

export function useProperty(id: number) {
  const client = useSupabase();
  return useQuery({ queryKey: apartmentKeys.one(id), queryFn: () => fetchProperty(client, id) });
}

/** The three columns Hostaway does not own. See savePropertyInfo. */
export function useSaveInfo(id: number) {
  const client = useSupabase();
  const invalidate = useInvalidateEverywhere();
  return useMutation({
    mutationFn: (draft: InfoDraft) => savePropertyInfo(client, id, draft),
    onSuccess: invalidate,
  });
}

export function useReservations(propertyId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: [...apartmentKeys.one(propertyId), 'reservations'],
    queryFn: () => fetchReservations(client, propertyId),
  });
}

export function useMaintenance(propertyId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: [...apartmentKeys.one(propertyId), 'maintenance'],
    queryFn: () => fetchMaintenanceTasks(client, propertyId),
  });
}

export function usePropertyProblems(propertyId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: [...apartmentKeys.one(propertyId), 'problems'],
    queryFn: () => fetchPropertyProblems(client, propertyId),
  });
}

export function useChecklist(propertyId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: [...apartmentKeys.one(propertyId), 'checklist'],
    queryFn: () => fetchChecklist(client, propertyId),
  });
}

/** Which flat the checklist on screen actually belongs to. */
export function useChecklistOwner(propertyId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: [...apartmentKeys.one(propertyId), 'checklist-owner'],
    queryFn: () => fetchChecklistOwner(client, propertyId),
  });
}

export function useSaveChecklist(propertyId: number) {
  const client = useSupabase();
  const invalidate = useInvalidateEverywhere();
  return useMutation({
    mutationFn: (modules: ChecklistModule[]) => saveChecklist(client, propertyId, modules),
    onSuccess: invalidate,
  });
}

export function useCopyChecklist(propertyId: number) {
  const client = useSupabase();
  const invalidate = useInvalidateEverywhere();
  return useMutation({
    mutationFn: (sourcePropertyId: number) => copyChecklist(client, sourcePropertyId, propertyId),
    onSuccess: invalidate,
  });
}
