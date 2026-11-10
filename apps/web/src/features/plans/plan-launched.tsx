'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStaff } from '@/features/problems/use-problems';
import { formatDay } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import {
  draftFromStep,
  groupByTheme,
  isStepDropped,
  refusalsOf,
  type DraftStep,
} from './draft-model';
import { EffectBlock } from './effect-block';
import { PlanStepsEditor } from './plan-steps-editor';
import { PLAN_STATUS_TONE, type Plan, type PlanStep } from './schema';
import { useCancelPlan, useLaunchPlan, useSavePlan, useSetStepDecided } from './use-plans';

/** Where a launched step lives; a decision lives here. */
function workHref(step: PlanStep): string | null {
  if (step.kind === 'repair') {
    return `/problems/${step.linked_problem_id ?? step.id}`;
  }
  if (step.kind === 'inspection') {
    return `/tasks/${step.id}`;
  }
  return step.kind === 'purchase' ? '/supplies' : null;
}

interface StepLineProps {
  step: PlanStep;
  isOpenPlan: boolean;
}

function StepLine({ step, isOpenPlan }: StepLineProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const decide = useSetStepDecided();
  const href = workHref(step);
  const isClosed = step.state === 'closed';
  const isDropped = isStepDropped(step);

  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium break-words">{step.title}</p>
        <p className="text-xs text-muted-foreground">
          {[
            t(`panel.plans.kinds.${step.kind}`),
            step.assignee_name,
            step.due_on === null ? null : formatDay(step.due_on, language),
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={isDropped ? 'cancelled' : isClosed ? 'done' : 'inProgress'}>
          {t(`panel.plans.step.${isDropped ? 'dropped' : step.state}`)}
        </Badge>
        {href === null ? null : (
          <Link href={href} className="text-sm underline underline-offset-4">
            {t('panel.plans.step.openWork')}
          </Link>
        )}
        {step.kind === 'decision' && isOpenPlan ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ stepId: step.id, isDecided: !isClosed })}
          >
            {t(isClosed ? 'panel.plans.step.undecide' : 'panel.plans.step.decide')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

interface NewStepsProps {
  plan: Plan;
  pending: readonly PlanStep[];
}

/** Steps added to a plan already at work: drafts until they are launched on their own. */
function NewSteps({ plan, pending }: NewStepsProps) {
  const { t } = useTranslation();
  const staff = useStaff().data ?? [];
  const save = useSavePlan();
  const launch = useLaunchPlan();
  const [steps, setSteps] = useState<DraftStep[]>(pending.map(draftFromStep));
  const [rev, setRev] = useState(plan.rev);
  const [saved, setSaved] = useState(steps);
  const isDirty = JSON.stringify(steps) !== JSON.stringify(saved);
  const failure = save.error ?? launch.error;
  const failureText = failure === null ? null : serverErrorText(failure);
  const variables = {
    planId: plan.id,
    placeId: plan.property_id,
    title: plan.title,
    steps,
    rev,
  };

  const remember = (next: Plan) => {
    setRev(next.rev);
    setSaved(next.steps.filter((step) => step.launched_at === null).map(draftFromStep));
  };

  return (
    <section className="flex flex-col gap-2" aria-label={t('panel.plans.newSteps')}>
      <h2 className="text-base font-semibold">{t('panel.plans.newSteps')}</h2>
      <PlanStepsEditor
        steps={steps}
        staff={staff}
        refusals={refusalsOf(launch.error)}
        themeFacts={() => null}
        onChange={setSteps}
      />
      {failureText === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failureText.text}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11"
          disabled={steps.length === 0 || launch.isPending || save.isPending}
          onClick={() =>
            launch.mutate({
              planId: plan.id,
              rev,
              save: isDirty ? variables : null,
              onSaved: remember,
            })
          }
        >
          {t('panel.plans.launchNew')}
        </Button>
        {/* A step taken back after a refused launch is gone only once it is saved. */}
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={!isDirty || launch.isPending || save.isPending}
          onClick={() => save.mutate(variables, { onSuccess: remember })}
        >
          {t('panel.plans.save')}
        </Button>
      </div>
    </section>
  );
}

/** A plan at work, or finished: progress by theme, and each step where it lives (§6.2). */
export function PlanLaunched({ plan }: { plan: Plan }) {
  const { t } = useTranslation();
  const language = useLanguage();
  const cancel = useCancelPlan();
  const [isCancelling, setCancelling] = useState(false);
  const launched = plan.steps.filter((step) => step.launched_at !== null);
  const pending = plan.steps.filter((step) => step.launched_at === null);
  const closed = launched.filter((step) => step.state === 'closed').length;
  const dropped = launched.filter(isStepDropped).length;
  const isOpenPlan = plan.status !== 'cancelled';
  const failure = cancel.isError ? serverErrorText(cancel.error) : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={{ href: `/quality/${plan.property_id}`, label: plan.property_name ?? '' }}
        title={plan.title}
        meta={<Badge tone={PLAN_STATUS_TONE[plan.status]}>{t(`panel.plans.status.${plan.status}`)}</Badge>}
        description={t('panel.plans.progress', { closed, total: launched.length })}
        actions={
          plan.status === 'launched' ? (
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setCancelling(true)}
            >
              {t('panel.plans.cancel')}
            </Button>
          ) : undefined
        }
      />
      {plan.closed_at === null ? null : (
        <p className="text-sm text-muted-foreground">
          {t('panel.plans.closedOn', { day: formatDay(plan.closed_at.slice(0, 10), language) })}
        </p>
      )}
      {plan.status === 'done' ? <EffectBlock planId={plan.id} /> : null}
      {dropped === 0 ? null : (
        <p className="text-sm text-muted-foreground">
          {t('panel.plans.droppedNote', { n: dropped })}
        </p>
      )}
      {groupByTheme(launched).map(({ theme, steps }) => {
        const name = t(`panel.quality.themes.${theme}`, { defaultValue: theme });
        return (
          <section
            key={theme}
            aria-label={name}
            className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <h2 className="text-base font-semibold break-words">{name}</h2>
            <ul className="flex flex-col gap-2">
              {steps.map((step) => (
                <StepLine key={step.id} step={step} isOpenPlan={isOpenPlan} />
              ))}
            </ul>
          </section>
        );
      })}
      {isOpenPlan ? <NewSteps key={launched.length} plan={plan} pending={pending} /> : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
        </p>
      )}

      {isCancelling ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setCancelling(false))}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('panel.plans.cancelConfirm')}</DialogTitle>
              <DialogDescription>{t('panel.plans.cancelText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setCancelling(false)}
              >
                {t('panel.plans.abort')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-11"
                onClick={() => {
                  setCancelling(false);
                  cancel.mutate({ planId: plan.id, rev: plan.rev });
                }}
              >
                {t('panel.plans.cancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
