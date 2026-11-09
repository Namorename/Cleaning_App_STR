import { CLOSED_HOWS, type ClosingRow } from '@str-ops/shared';
import { z } from 'zod';

/**
 * Who did a task's work and who closed it (20261106125000). The names come through the
 * computed field closing_people: a technician reads no colleague's profile, and the head
 * technician's board embeds none.
 *
 * Read only once that migration is in the cloud: a select of a column the server does not
 * have answers 42703 and empties the screen. This build goes out with the OTA that follows it.
 */
export const CLOSING_COLUMNS = 'completed_by, closed_how, closed_cause, closing:closing_people, ';

const personSchema = z
  .object({
    name: z.string().nullable().default(null),
    role: z.string().nullable().default(null),
  })
  .nullable()
  .catch(null)
  .default(null);

/** Absent from a phone's saved copy of an older build, as the guest signal's fields are. */
export const closingFields = {
  completed_by: z.string().uuid().nullable().catch(null).optional(),
  closed_how: z.enum(CLOSED_HOWS).nullable().catch(null).optional(),
  closed_cause: z.string().nullable().catch(null).optional(),
  closing: z
    .object({ completed_by: personSchema, closed_by: personSchema })
    .nullable()
    .catch(null)
    .optional(),
};

interface ClosingFields {
  readonly status: string;
  readonly archived_at?: string | null;
  readonly completed_by?: string | null;
  readonly closed_how?: ClosingRow['closed_how'];
  readonly closed_cause?: string | null;
  readonly closing?: ClosingRow['closing'];
}

/** A task as the shared wording reads it: what the phone has not read is not known. */
export function closingRowOf(problem: ClosingFields): ClosingRow {
  return {
    status: problem.status,
    archived_at: problem.archived_at ?? null,
    completed_by: problem.completed_by ?? null,
    closed_how: problem.closed_how ?? null,
    closed_cause: problem.closed_cause ?? null,
    closing: problem.closing ?? null,
  };
}
