import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ProblemDetail } from '@/features/problems/problem-detail';
import { roleOf } from '@/lib/session';
import { createClient } from '@/lib/supabase/server';

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
 *
 * Who reads the page is read here, from app_metadata: an admin may delete an
 * archived task for good (20261126150000) — the database refuses anybody else
 * either way.
 */
export default async function ProblemPage({ params }: ProblemPageProps) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return <ProblemDetail problemId={parsed.data.id} isAdmin={roleOf(user) === 'admin'} />;
}
