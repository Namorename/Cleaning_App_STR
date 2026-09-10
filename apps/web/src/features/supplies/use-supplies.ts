'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSupabase } from '@/lib/supabase/use-client';

import { fetchSupplyRequests, reviewSupplyRequest, type ReviewVariables } from './api';
import { supplyKeys } from './keys';

export function useSupplyRequests() {
  const client = useSupabase();
  return useQuery({ queryKey: supplyKeys.list(), queryFn: () => fetchSupplyRequests(client) });
}

export function useReviewSupplyRequest() {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: ReviewVariables) => reviewSupplyRequest(client, variables),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: supplyKeys.all }),
  });
}
