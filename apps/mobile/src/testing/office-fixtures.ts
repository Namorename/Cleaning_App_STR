import type { OfficeTask } from '@/features/office/schema';

import { CLEANER_ANNA } from './board-fixtures';

/**
 * The office's company as its tests meet it: a manager on the phone, two
 * cleaners, and cleanings in two houses — one of them with rooms.
 */

export const MANAGER = 'c2d3e4f5-3333-4333-8333-c2d3e4f50001';
export const CLEANER_VERA = 'e3f4a5b6-4444-4444-8444-e3f4a5b60001';

export const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';

/** A cleaning given to Anna today in Nádražní, as the office reads it. */
export function officeTask(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return {
    id: TASK_ID,
    status: 'assigned',
    priority: 0,
    scheduled_date: '2026-11-18',
    due_at: null,
    assignee_id: CLEANER_ANNA,
    property_id: 412432,
    reservation_id: 9001,
    problem_id: null,
    property: {
      name: 'CZ - Nadrazni Apt 6',
      address: 'Nádražní 6',
      hostaway_unit_id: null,
      effective_cleaner_notes: null,
      parent: null,
    },
    time_from: '10:00:00',
    time_to: '15:00:00',
    guests_count: 2,
    started_at: null,
    completed_at: null,
    is_parallel: false,
    type: 'cleaning',
    notes: null,
    title: null,
    title_i18n: {},
    assignee: { full_name: 'Анна Белова' },
    cancelled_at: null,
    release_kind: null,
    offs: null,
    ...overrides,
  };
}

/** A room of Vinohradska Royal, the house with rooms. */
export const ROYAL_ROOM: NonNullable<OfficeTask['property']> = {
  name: '1 - 2109',
  address: 'Vinohradská 12',
  hostaway_unit_id: 2109,
  effective_cleaner_notes: null,
  parent: { name: 'CZ - Vinohradska Royal' },
};
