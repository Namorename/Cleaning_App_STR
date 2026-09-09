'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

import {
  fetchSupplyRequests,
  reviewSupplyRequest,
  type Client,
  type ReviewVariables,
} from './api';
import { supplyKeys } from './keys';

function useSupabase(): Client {
  const [client] = useState(() => createClient());
  return client;
}

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
