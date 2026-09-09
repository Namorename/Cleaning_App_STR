import { notFound } from 'next/navigation';
import { z } from 'zod';

import { ProblemDetail } from '@/features/problems/problem-detail';

const Params = z.object({ id: z.uuid() });

interface ProblemPageProps {
  params: Promise<{ id: string }>;
}

/** A malformed id is a 404, not a query. */
export default async function ProblemPage({ params }: ProblemPageProps) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    notFound();
  }
  return <ProblemDetail problemId={parsed.data.id} />;
}
