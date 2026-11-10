'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';

import { problemKeys } from '@/features/problems/keys';
import { useSupabase } from '@/lib/supabase/use-client';

import {
  cancelPlan,
  deletePlan,
  fetchPlacePlans,
  fetchPlaceWork,
  fetchPlan,
  fetchPlanEffect,
  launchPlan,
  savePlan,
  setStepDecided,
  type SavePlanVariables,
} from './api';
import { draftFromStep, proposeSteps, themesToAdd, type StepWords } from './draft-model';
import { planKeys } from './keys';
import type { Plan } from './schema';
import { useStepWords } from './step-words';

export function usePlan(planId: string) {
  const client = useSupabase();
  return useQuery({ queryKey: planKeys.plan(planId), queryFn: () => fetchPlan(client, planId) });
}

export function usePlanEffect(planId: string) {
  const client = useSupabase();
  return useQuery({
    queryKey: planKeys.effect(planId),
    queryFn: () => fetchPlanEffect(client, planId),
  });
}

export function usePlacePlans(placeId: number) {
  const client = useSupabase();
  return useQuery({
    queryKey: planKeys.place(placeId),
    queryFn: () => fetchPlacePlans(client, placeId),
  });
}

function useInvalidatePlans() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: planKeys.all }),
      queryClient.invalidateQueries({ queryKey: problemKeys.all }),
    ]);
}

export function useSavePlan() {
  const client = useSupabase();
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: (variables: SavePlanVariables) => savePlan(client, variables),
    onSuccess: invalidate,
  });
}

export interface LaunchVariables {
  /** Set when the editor holds changes: they are saved first, or the launch would miss them. */
  save: SavePlanVariables | null;
  planId: string;
  rev: number;
  /** A failed launch after a good save must not leave the editor on the old revision. */
  onSaved: (plan: Plan) => void;
}

export function useLaunchPlan() {
  const client = useSupabase();
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: async ({ save, planId, rev, onSaved }: LaunchVariables) => {
      if (save === null) {
        return launchPlan(client, planId, rev);
      }
      const saved = await savePlan(client, save);
      onSaved(saved);
      return launchPlan(client, planId, saved.rev);
    },
    onSuccess: invalidate,
  });
}

export function useDeletePlan() {
  const client = useSupabase();
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: ({ planId, rev }: { planId: string; rev: number }) =>
      deletePlan(client, planId, rev),
    onSuccess: invalidate,
  });
}

export function useCancelPlan() {
  const client = useSupabase();
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: ({ planId, rev }: { planId: string; rev: number }) =>
      cancelPlan(client, planId, rev),
    onSuccess: invalidate,
  });
}

export function useSetStepDecided() {
  const client = useSupabase();
  const invalidate = useInvalidatePlans();
  return useMutation({
    mutationFn: ({ stepId, isDecided }: { stepId: string; isDecided: boolean }) =>
      setStepDecided(client, stepId, isDecided),
    onSuccess: invalidate,
  });
}

interface GatherOptions {
  placeId: number;
  placeName: string;
}

/**
 * «Собрать план» and «В план»: the themes go into the place's draft, a new one if it has none,
 * and the manager lands in the editor. Nothing here reaches anybody: that takes the launch.
 */
export function useGatherPlan({ placeId, placeName }: GatherOptions) {
  const client = useSupabase();
  const router = useRouter();
  const invalidate = useInvalidatePlans();
  const { t } = useTranslation();
  const words: StepWords = useStepWords();

  return useMutation({
    mutationFn: async (themes: readonly string[]) => {
      const [plans, work] = await Promise.all([
        fetchPlacePlans(client, placeId),
        fetchPlaceWork(client, placeId),
      ]);
      const makeId = () => crypto.randomUUID();
      const draft = plans.find((plan) => plan.status === 'draft') ?? null;
      if (draft === null) {
        return savePlan(client, {
          planId: makeId(),
          placeId,
          title: t('panel.plans.defaultTitle', { place: placeName }),
          steps: proposeSteps(themes, work, words, makeId),
          rev: null,
        });
      }
      const current = await fetchPlan(client, draft.id);
      if (current === null) {
        throw new Error('The draft is gone');
      }
      const added = themesToAdd(themes, current.steps);
      if (added.length === 0) {
        return current;
      }
      return savePlan(client, {
        planId: current.id,
        placeId,
        title: current.title,
        steps: [...current.steps.map(draftFromStep), ...proposeSteps(added, work, words, makeId)],
        rev: current.rev,
      });
    },
    onSuccess: async (plan) => {
      await invalidate();
      router.push(`/quality/plans/${plan.id}`);
    },
  });
}
