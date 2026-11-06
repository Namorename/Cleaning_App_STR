import { z } from 'zod';

import type { Client } from './api';

const problemThemeSchema = z
  .object({
    theme: z.string(),
    source: z.enum(['signal', 'dict', 'manual']),
  })
  .nullable();

export type ProblemTheme = z.infer<typeof problemThemeSchema>;

export interface SetProblemThemeVariables {
  problemId: string;
  /** Null takes the hand away: the dictionary may speak again at night. */
  theme: string | null;
}

/** What the task is about, and who said so. Null while nobody has. */
export async function fetchProblemTheme(client: Client, problemId: string): Promise<ProblemTheme> {
  const { data, error } = await client.rpc('problem_theme', { p_problem_id: problemId });
  if (error) {
    throw error;
  }
  return problemThemeSchema.parse(data);
}

export async function setProblemTheme(
  client: Client,
  variables: SetProblemThemeVariables,
): Promise<ProblemTheme> {
  const { data, error } = await client.rpc('set_problem_theme', {
    p_problem_id: variables.problemId,
    // The generated types know no null argument; the function reads it as «take the hand away».
    p_theme: variables.theme as string,
  });
  if (error) {
    throw error;
  }
  return problemThemeSchema.parse(data);
}
