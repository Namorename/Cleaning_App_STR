import { notFound } from 'next/navigation';
import { z } from 'zod';

import { readProblemsView } from '@/features/problems/address';
import { ProblemDetail } from '@/features/problems/problem-detail';

const Params = z.object({ id: z.uuid() });

interface ProblemPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A malformed id is a 404, not a query. `?view=` is the view of «Задания» the
 * task was opened from (owner, 05.10): «К списку заданий» returns to it; a
 * task opened from elsewhere returns to the board.
 */
export default async function ProblemPage({ params, searchParams }: ProblemPageProps) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  const listView = readProblemsView((await searchParams).view);
  return <ProblemDetail problemId={parsed.data.id} listView={listView} />;
}
