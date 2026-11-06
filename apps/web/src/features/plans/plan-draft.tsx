'use client';

import { DEFAULT_QUALITY_WINDOW } from '@str-ops/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStaff } from '@/features/problems/use-problems';
import { useQualityPlace } from '@/features/quality/use-quality';
import { serverErrorKey, serverErrorText } from '@/lib/server-error';

import { draftFromStep, planSummary, refusalsOf, type DraftStep } from './draft-model';
import { PlanStepsEditor } from './plan-steps-editor';
import type { Plan } from './schema';
import { useDeletePlan, useLaunchPlan, useSavePlan } from './use-plans';

interface PlanDraftProps {
  plan: Plan;
  /** Reads the plan again and opens the editor on what the server holds. */
  onReload: () => void;
}

function useThemeFacts(placeId: number) {
  const { t } = useTranslation();
  const card = useQualityPlace(placeId, DEFAULT_QUALITY_WINDOW).data ?? null;

  return (theme: string): string | null => {
    const row = card?.themes.find((item) => item.theme === theme);
    if (row === undefined) {
      return null;
    }
    const said = [
      row.reviews > 0 ? t('panel.quality.layers.reviews', { count: row.reviews }) : null,
      row.found > 0 ? t('panel.quality.layers.found', { count: row.found }) : null,
      row.reported > 0 ? t('panel.quality.layers.reported', { count: row.reported }) : null,
    ].filter((text) => text !== null);
    return said.length === 0 ? null : said.join(' · ');
  };
}

/**
 * The draft of a plan (§5.3): nobody but the office sees it. Everything is held here until
 * «Сохранить», and a launch saves first, so the plan launched is the plan on the screen.
 */
export function PlanDraft({ plan, onReload }: PlanDraftProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const staff = useStaff().data ?? [];
  const themeFacts = useThemeFacts(plan.property_id);
  const save = useSavePlan();
  const launch = useLaunchPlan();
  const remove = useDeletePlan();

  const [title, setTitle] = useState(plan.title);
  const [steps, setSteps] = useState<DraftStep[]>(plan.steps.map(draftFromStep));
  const [rev, setRev] = useState(plan.rev);
  const [saved, setSaved] = useState({ title: plan.title, steps: plan.steps.map(draftFromStep) });
  const [isConfirming, setConfirming] = useState(false);
  const [isDeleting, setDeleting] = useState(false);

  const isDirty = title !== saved.title || JSON.stringify(steps) !== JSON.stringify(saved.steps);
  const variables = { planId: plan.id, placeId: plan.property_id, title, steps, rev };
  const summary = planSummary(steps);
  const isBusy = save.isPending || launch.isPending || remove.isPending;
  const failure = save.error ?? launch.error ?? remove.error;
  const failureText = failure === null ? null : serverErrorText(failure);
  const isStale = failure !== null && serverErrorKey(failure) === 'serverErrors.planChanged';

  const remember = (next: Plan) => {
    setRev(next.rev);
    setSaved({ title: next.title, steps: next.steps.map(draftFromStep) });
  };
  const onSave = () => {
    launch.reset();
    save.mutate(variables, { onSuccess: remember });
  };
  const onLaunch = () => {
    save.reset();
    setConfirming(false);
    launch.mutate({
      planId: plan.id,
      rev,
      save: isDirty ? variables : null,
      onSaved: remember,
    });
  };
  const onDelete = () => {
    remove.mutate(
      { planId: plan.id, rev },
      { onSuccess: () => router.replace(`/quality/${plan.property_id}`) },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={{ href: `/quality/${plan.property_id}`, label: plan.property_name ?? '' }}
        title={t('panel.plans.draftTitle')}
        description={t('panel.plans.draftHint')}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="plan-title">{t('panel.plans.planTitle')}</Label>
        <Input
          id="plan-title"
          className="h-11"
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <PlanStepsEditor
        steps={steps}
        staff={staff}
        refusals={refusalsOf(launch.error)}
        themeFacts={themeFacts}
        onChange={setSteps}
      />
      <p className="text-sm text-muted-foreground">{t('panel.plans.summary', { ...summary })}</p>
      {failureText === null ? null : (
        <div role="alert" className="flex flex-col items-start gap-1 text-sm text-destructive">
          <p>{failureText.text}</p>
          {failureText.detail === null ? null : (
            <p className="text-xs text-muted-foreground">{failureText.detail}</p>
          )}
          {isStale ? (
            <Button type="button" variant="outline" className="h-11" onClick={onReload}>
              {t('panel.plans.reload')}
            </Button>
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          className="h-11"
          disabled={isBusy || steps.length === 0}
          onClick={() => setConfirming(true)}
        >
          {t('panel.plans.launch')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={isBusy || !isDirty}
          onClick={onSave}
        >
          {t('panel.plans.save')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          disabled={isBusy}
          onClick={() => setDeleting(true)}
        >
          {t('panel.plans.delete')}
        </Button>
      </div>

      {isConfirming ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setConfirming(false))}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('panel.plans.launchConfirm')}</DialogTitle>
              <DialogDescription>{t('panel.plans.summary', { ...summary })}</DialogDescription>
            </DialogHeader>
            <p className="text-sm">{t('panel.plans.launchText')}</p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setConfirming(false)}
              >
                {t('panel.plans.abort')}
              </Button>
              <Button type="button" className="h-11" onClick={onLaunch}>
                {t('panel.plans.launch')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {isDeleting ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setDeleting(false))}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t('panel.plans.deleteConfirm')}</DialogTitle>
              <DialogDescription>{t('panel.plans.deleteText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setDeleting(false)}
              >
                {t('panel.plans.abort')}
              </Button>
              <Button type="button" variant="destructive" className="h-11" onClick={onDelete}>
                {t('panel.plans.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
