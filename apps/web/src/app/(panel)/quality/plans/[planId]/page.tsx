import { notFound } from 'next/navigation';
import { z } from 'zod';

import { PlanPage } from '@/features/plans/plan-page';

interface PlanRouteProps {
  params: Promise<{ planId: string }>;
}

/**
 * One plan of resolution. A UUID only: anything else is a 404, so a path the proxy lets past its
 * check (`x.png`) opens nothing here (app/__tests__/panel-routes.test.ts).
 */
export default async function PlanRoute({ params }: PlanRouteProps) {
  const parsed = z.uuid().safeParse((await params).planId);
  if (!parsed.success) {
    notFound();
  }
  return <PlanPage planId={parsed.data} />;
}
