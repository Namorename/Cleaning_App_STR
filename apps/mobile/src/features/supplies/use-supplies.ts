import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useSession } from '@/features/auth/session';

import {
  deleteSupplyRequest,
  fetchMySupplyRequests,
  fetchSupplyCatalog,
  fetchSupplyRequest,
  saveSupplyRequest,
  type SaveSupplyRequestVariables,
} from './api';
import { supplyKeys, supplyMutationKeys } from './keys';
import type { SupplyRequest } from './schema';

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
    enabled: userId !== null,
  });
}

export function useSupplyRequest(requestId: string) {
  const { userId } = useSession();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: supplyKeys.one(requestId),
    queryFn: () => fetchSupplyRequest(requestId),
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
