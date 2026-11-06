'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';

import { PlanDraft } from './plan-draft';
import { PlanLaunched } from './plan-launched';
import { usePlan } from './use-plans';

/** One plan: its editor while it is a draft, its progress after the launch. */
export function PlanPage({ planId }: { planId: string }) {
  const { t } = useTranslation();
  const read = usePlan(planId);
  const [opened, setOpened] = useState(0);

  if (read.isError) {
    return <ErrorState message={t('panel.plans.loadError')} error={read.error} />;
  }
  if (read.data === undefined) {
    return <LoadingState>{t('common.loading')}</LoadingState>;
  }
  if (read.data === null) {
    return <EmptyState>{t('panel.plans.notFound')}</EmptyState>;
  }
  if (read.data.status === 'draft') {
    return (
      <PlanDraft
        key={`${read.data.id}:${opened}`}
        plan={read.data}
        onReload={() => void read.refetch().then(() => setOpened((count) => count + 1))}
      />
    );
  }
  return <PlanLaunched plan={read.data} />;
}
