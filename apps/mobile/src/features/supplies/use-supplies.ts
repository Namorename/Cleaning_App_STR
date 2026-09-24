import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';
import { readCached } from '@/lib/read-cached';

import {
  deleteSupplyRequest,
  fetchMySupplyRequests,
  fetchSupplyCatalog,
  fetchSupplyRequest,
  saveSupplyRequest,
  type SaveSupplyRequestVariables,
} from './api';
import { supplyKeys, supplyMutationKeys } from './keys';
import { supplyRequestListSchema, supplyRequestSchema, type SupplyRequest } from './schema';

/**
 * Requests restored from disk come back in the shape the build that saved
 * them read (`readCached`): the house under a room's name, asked for since, is
 * simply missing. Read through the schema it is null instead of undefined.
 * Module-level so a query runs them only when its data changes.
 */
const oneOrNoRequestSchema = supplyRequestSchema.nullable();

function readRequests(data: unknown): SupplyRequest[] {
  return readCached(supplyRequestListSchema, data, 'supply requests');
}

function readRequest(data: unknown): SupplyRequest | null {
  return readCached(oneOrNoRequestSchema, data, 'supply request');
}

/** The list she picks from; the manager edits it rarely, so a stale copy is fine. */
export function useSupplyCatalog() {
  const { userId } = useSession();

  return useQuery({
    queryKey: supplyKeys.catalog(),
    queryFn: fetchSupplyCatalog,
    enabled: userId !== null,
  });
}

/** Teach the query client how to replay each write after a restart. */
export function registerSupplyMutations(queryClient: QueryClient): void {
  queryClient.setMutationDefaults(supplyMutationKeys.save, {
    mutationFn: (variables: SaveSupplyRequestVariables) => saveSupplyRequest(variables),
  });
  queryClient.setMutationDefaults(supplyMutationKeys.delete, {
    mutationFn: (requestId: string) => deleteSupplyRequest(requestId),
  });
}

export function useMySupplyRequests() {
  const { userId } = useSession();

  return useQuery({
    queryKey: supplyKeys.mine(),
    queryFn: fetchMySupplyRequests,
    select: readRequests,
    enabled: userId !== null,
  });
}

export function useSupplyRequest(requestId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: supplyKeys.one(requestId),
    queryFn: () => fetchSupplyRequest(requestId),
    // The list's copy seeds the screen below, raw from disk like any other.
    select: readRequest,
    enabled: userId !== null && requestId !== '',
    initialData: () =>
      queryClient
        .getQueryData<SupplyRequest[]>(supplyKeys.mine())
        ?.find((request) => request.id === requestId),
    initialDataUpdatedAt: 0,
  });
}

function useInvalidateSupplies() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: supplyKeys.all });
  };
}

export function useSaveSupplyRequest() {
  const invalidate = useInvalidateSupplies();

  return useMutation<SupplyRequest, Error, SaveSupplyRequestVariables>({
    mutationKey: supplyMutationKeys.save,
    mutationFn: saveSupplyRequest,
    onSuccess: invalidate,
  });
}

export function useDeleteSupplyRequest() {
  const invalidate = useInvalidateSupplies();

  return useMutation<boolean, Error, string>({
    mutationKey: supplyMutationKeys.delete,
    mutationFn: deleteSupplyRequest,
    onSuccess: invalidate,
  });
}
