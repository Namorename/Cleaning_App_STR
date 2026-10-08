import { z } from 'zod';

/**
 * The words of a task's history (problem_events, 20261003140000). The panel
 * has no history screen yet — the redesign of «Задания» brings one; the line
 * it needs for a take-off is settled here, with its keys in three languages,
 * so the screen only renders it.
 */

/** What a taken_off event carries: whom, and why when the take-off said so. */
const takenOffParamsSchema = z
  .object({
    assignee: z.string().optional(),
    cause: z.string().optional(),
  })
  .catch({});

export type TakenOffKey =
  | 'panel.problems.history.takenOff'
  | 'panel.problems.history.takenOffAccountDisabled';

/**
 * A take-off by the switch of an account says so: params.cause =
 * 'account_disabled' (20261004100000, owner's answer 3 of 2026-10-04).
 * Anything else — the office's «Снять», a cause this build does not know, a
 * row from before — reads as a plain take-off. Both keys take {{name}}.
 */
export function takenOffKey(params: unknown): TakenOffKey {
  const { cause } = takenOffParamsSchema.parse(params ?? {});
  return cause === 'account_disabled'
    ? 'panel.problems.history.takenOffAccountDisabled'
    : 'panel.problems.history.takenOff';
}
