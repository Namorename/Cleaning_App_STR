import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ProblemDetail } from '@/features/problems/problem-detail';

const Params = z.object({ id: z.uuid() });

interface ProblemPageProps {
  params: Promise<{ id: string }>;
}

/**
 * A malformed id is a 404, not a query. The rest of the address is the
 * page's own to read (`problems/address.ts`): `?view=` is the view of
 * «Задания» the task was opened from (owner, 05.10) — «К списку заданий»
 * returns to it, a task opened from elsewhere to the board — and `?chat=1`
 * opens it with its conversation open.
 */
export default async function ProblemPage({ params }: ProblemPageProps) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  return <ProblemDetail problemId={parsed.data.id} />;
}
