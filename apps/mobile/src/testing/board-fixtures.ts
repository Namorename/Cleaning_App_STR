import type { BoardProblem, BoardRepair, StaffMember } from '@/features/board/schema';
import { calendarDay } from '@/features/tasks/schema';

/**
 * The head technician's company as the board tests meet it: himself, two
 * technicians, one switched off, and a cleaner — who may hold a repair
 * (tech-plan §0) but is never offered one by him.
 */

export const HEAD_TECH = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const TECH_IVAN = '8d0f7780-8536-41ef-a55c-f18e2a01ab08';
export const TECH_OLGA = '9e1a8891-9647-42f0-b66d-a29f3b12bc19';
export const TECH_GONE = 'a0b19902-a758-43a1-877e-b3a04c23cd2a';
export const CLEANER_ANNA = 'b1c2aa13-b869-44b2-988f-c4b15d34de3b';

export const STAFF: StaffMember[] = [
  { id: CLEANER_ANNA, full_name: 'Анна Белова', role: 'cleaner', is_active: true },
  { id: TECH_IVAN, full_name: 'Иван Петров', role: 'tech', is_active: true },
  { id: TECH_OLGA, full_name: 'Ольга Сидорова', role: 'tech', is_active: true },
  { id: TECH_GONE, full_name: 'Пётр Уволенный', role: 'tech', is_active: false },
  { id: HEAD_TECH, full_name: 'Сергей Главный', role: 'head_tech', is_active: true },
];

export const PROBLEM_ID = 'd1e2f3a4-1111-4111-8111-d1e2f3a40001';
export const REPAIR_ID = 'b1c2d3e4-2222-4222-8222-b1c2d3e40001';

/** Today on the phone's calendar, as `scheduled_date` writes it. */
export function today(): string {
  return calendarDay(new Date());
}

export function repair(overrides: Partial<BoardRepair> = {}): BoardRepair {
  return {
    id: REPAIR_ID,
    type: 'maintenance',
    assignee_id: TECH_IVAN,
    status: 'assigned',
    scheduled_date: today(),
    time_from: null,
    time_to: null,
    ...overrides,
  };
}

export function boardProblem(overrides: Partial<BoardProblem> = {}): BoardProblem {
  return {
    id: PROBLEM_ID,
    property_id: 412432,
    title: 'Кран течёт',
    priority: 'normal',
    status: 'open',
    archived_at: null,
    created_at: '2026-10-05T08:00:00+00:00',
    property: { name: 'CZ - Nadrazni Apt 6', hostaway_unit_id: null, parent: null },
    fix_tasks: [],
    ...overrides,
  };
}
