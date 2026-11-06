'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { serverErrorText } from '@/lib/server-error';

import { themesInLivePlans } from './draft-model';
import { PLAN_STATUS_TONE, type PlacePlan } from './schema';
import { useGatherPlan, usePlacePlans } from './use-plans';

interface PlacePlansProps {
  placeId: number;
  placeName: string;
  /** What «Собрать план» starts from: the themes that matter now. */
  themes: readonly string[];
}

function PlanLine({ plan }: { plan: PlacePlan }) {
  const { t } = useTranslation();

  return (
    <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <Link
        href={`/quality/plans/${plan.id}`}
        className="min-w-0 font-medium break-words underline underline-offset-4"
      >
        {plan.title}
      </Link>
      <span className="flex flex-wrap items-center gap-2">
        {plan.status === 'draft' ? null : (
          <span className="text-xs text-muted-foreground">
            {t('panel.plans.progress', { closed: plan.steps_closed, total: plan.steps_total })}
          </span>
        )}
        <Badge tone={PLAN_STATUS_TONE[plan.status]}>{t(`panel.plans.status.${plan.status}`)}</Badge>
      </span>
    </li>
  );
}

/** The plans of a place, and the button that gathers one from what matters now. */
export function PlacePlans({ placeId, placeName, themes }: PlacePlansProps) {
  const { t } = useTranslation();
  const plans = usePlacePlans(placeId);
  const gather = useGatherPlan({ placeId, placeName });
  const list = plans.data ?? [];
  const held = themesInLivePlans(list);
  const wanted = themes.filter((theme) => !held.has(theme));
  const failure = gather.isError ? serverErrorText(gather.error) : null;

  return (
    <section
      aria-label={t('panel.plans.blockTitle')}
      className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('panel.plans.blockTitle')}</h2>
        <Button
          type="button"
          className="h-11"
          disabled={gather.isPending || plans.isPending}
          onClick={() => gather.mutate(wanted)}
        >
          {t('panel.plans.gather')}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('panel.plans.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((plan) => (
            <PlanLine key={plan.id} plan={plan} />
          ))}
        </ul>
      )}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
        </p>
      )}
    </section>
  );
}

interface ThemePlanButtonProps {
  placeId: number;
  placeName: string;
  theme: string;
}

/** «В план» on a theme, or where the theme already is. */
export function ThemePlanButton({ placeId, placeName, theme }: ThemePlanButtonProps) {
  const { t } = useTranslation();
  const plans = usePlacePlans(placeId);
  const gather = useGatherPlan({ placeId, placeName });
  const planId = themesInLivePlans(plans.data ?? []).get(theme);
  const failure = gather.isError ? serverErrorText(gather.error) : null;

  if (planId !== undefined) {
    return (
      <Link href={`/quality/plans/${planId}`} className="text-sm underline underline-offset-4">
        {t('panel.plans.inPlan')}
      </Link>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        className="h-11 self-start"
        disabled={gather.isPending || plans.isPending}
        onClick={() => gather.mutate([theme])}
      >
        {t('panel.plans.addTheme')}
      </Button>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
        </p>
      )}
    </div>
  );
}
