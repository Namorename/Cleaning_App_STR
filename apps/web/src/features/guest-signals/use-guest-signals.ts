'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { problemKeys } from '@/features/problems/keys';
import { useSupabase } from '@/lib/supabase/use-client';

import {
  addFinding,
  approveFinding,
  fetchCandidateCount,
  fetchFindings,
  fetchPlaceProblems,
  fetchReviews,
  fetchRunStatus,
  fetchSettings,
  rejectFinding,
  updateSettings,
  type AddFindingVariables,
  type ApproveVariables,
  type SettingsChange,
} from './api';
import { signalKeys } from './keys';
import { FINDING_TABS, type FindingTab, type RejectReason } from './schema';

/** The menu's count reads this every few minutes; the screen refreshes it on every decision. */
const COUNT_REFRESH_MS = 5 * 60 * 1000;

export function useFindings(tab: FindingTab) {
  const client = useSupabase();
  return useQuery({
    queryKey: signalKeys.findings(tab),
    queryFn: () => fetchFindings(client, FINDING_TABS[tab]),
  });
}

/** Candidates waiting; off for a person the section is not for (`enabled`). */
export function useCandidateCount(enabled = true) {
  const client = useSupabase();
  return useQuery({
    queryKey: signalKeys.count(),
    queryFn: () => fetchCandidateCount(client),
    refetchInterval: COUNT_REFRESH_MS,
    enabled,
  });
}

/** «Все отзывы»: the reviews themselves, newest first. */
export function useReviewList() {
  const client = useSupabase();
  return useQuery({ queryKey: signalKeys.list(), queryFn: () => fetchReviews(client) });
}

export function usePlaceProblems(findingId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: signalKeys.place(findingId),
    queryFn: () => fetchPlaceProblems(client, findingId),
  });
}

export function useSignalSettings() {
  const client = useSupabase();
  return useQuery({ queryKey: signalKeys.settings(), queryFn: () => fetchSettings(client) });
}

export function useRunStatus() {
  const client = useSupabase();
  return useQuery({ queryKey: signalKeys.runs(), queryFn: () => fetchRunStatus(client) });
}

/** After a decision: the findings, the count and the tasks board all moved. */
function useInvalidateAfterDecision() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: signalKeys.all }),
      queryClient.invalidateQueries({ queryKey: problemKeys.all }),
    ]);
}

export function useApproveFinding() {
  const client = useSupabase();
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: (v: ApproveVariables) => approveFinding(client, v),
    onSuccess: invalidate,
  });
}

export function useRejectFinding() {
  const client = useSupabase();
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: ({ findingId, reason }: { findingId: string; reason: RejectReason }) =>
      rejectFinding(client, findingId, reason),
    onSuccess: invalidate,
  });
}

export function useAddFinding() {
  const client = useSupabase();
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: (v: AddFindingVariables) => addFinding(client, v),
    onSuccess: invalidate,
  });
}

export function useUpdateSettings() {
  const client = useSupabase();
  const invalidate = useInvalidateAfterDecision();
  return useMutation({
    mutationFn: (change: SettingsChange) => updateSettings(client, change),
    onSuccess: invalidate,
  });
}
