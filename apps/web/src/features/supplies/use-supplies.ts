'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import {
  archiveCatalogItem,
  fetchCatalog,
  fetchCompanyLanguage,
  fetchSupplyRequests,
  reviewSupplyRequest,
  saveCatalogItem,
  type ReviewVariables,
} from './api';
import { supplyKeys } from './keys';
import type { CatalogItemDraft } from './schema';

export function useSupplyRequests() {
  const client = useSupabase();
  return useQuery({ queryKey: supplyKeys.list(), queryFn: () => fetchSupplyRequests(client) });
}

export function useReviewSupplyRequest() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: ReviewVariables) => reviewSupplyRequest(client, variables),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: supplyKeys.list() }),
  });
}

export function useCatalog() {
  const client = useSupabase();
  return useQuery({ queryKey: supplyKeys.catalog(), queryFn: () => fetchCatalog(client) });
}

/** The language the catalogue names are written in; it does not change while the panel is open. */
export function useCompanyLanguage() {
  const client = useSupabase();
  return useQuery({
    queryKey: supplyKeys.companyLanguage(),
    queryFn: () => fetchCompanyLanguage(client),
    staleTime: Infinity,
  });
}

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: supplyKeys.catalog() });
}

export function useSaveCatalogItem() {
  const client = useSupabase();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: (draft: CatalogItemDraft) => saveCatalogItem(client, draft),
    onSuccess: invalidate,
  });
}

export function useArchiveCatalogItem() {
  const client = useSupabase();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: ({ itemId, archived }: { itemId: string; archived: boolean }) =>
      archiveCatalogItem(client, itemId, archived),
    onSuccess: invalidate,
  });
}
