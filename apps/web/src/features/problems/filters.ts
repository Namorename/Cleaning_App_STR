import { propertyPath, splitPlace } from '@str-ops/shared';

import { todayIn } from '@/lib/format-date';

import { isProblemClosed, liveFixTask, matchesQuery, problemPlace, type Problem } from './schema';

/**
 * The filters of «Задания» (owner, 10.10: «по объекту, исполнителю, дате»):
 * one bar over the board, the list and the archive, kept in the address.
 */

/**
 * The company's own zone: a task's day is the day it was reported there, as
 * the server counts its days (`public.push_timezone()`, 20260928130000). One
 * company, one zone, until `hosts.timezone` comes with multitenancy (F25).
 */
export const COMPANY_TIME_ZONE = 'Europe/Prague';

/** No listing chosen, the tasks of no listing, or a place as the cards name it. */
export type PlaceFilter =
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'place'; readonly name: string };

export const ANY_PLACE: PlaceFilter = { kind: 'all' };
export const NO_PLACE: PlaceFilter = { kind: 'none' };

/** The person filter off. */
export const ANY_ASSIGNEE = 'all';
/** The live tasks nobody holds. */
export const NO_ASSIGNEE = 'nobody';

export interface ProblemFilters {
  /** The search over the title and the place. */
  query: string;
  place: PlaceFilter;
  /** A person's id, `all`, or `nobody` for the live tasks nobody holds. */
  assigneeId: string;
  /** `YYYY-MM-DD`, the day reported, both ends inclusive; empty is an open end. */
  dateFrom: string;
  dateTo: string;
}

export const EMPTY_PROBLEM_FILTERS: ProblemFilters = {
  query: '',
  place: ANY_PLACE,
  assigneeId: ANY_ASSIGNEE,
  dateFrom: '',
  dateTo: '',
};

/** Is anything set? What an empty view says, and whether «Сбросить» shows, depend on it. */
export function hasProblemFilters(filters: ProblemFilters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.place.kind !== 'all' ||
    filters.assigneeId !== ANY_ASSIGNEE ||
    filters.dateFrom !== '' ||
    filters.dateTo !== ''
  );
}

/**
 * The day a task was reported, as the company counts days. `created_at` is an
 * instant: a report made at half past midnight in Prague belongs to that day,
 * though UTC still calls it the evening before.
 */
export function reportedDay(problem: Pick<Problem, 'created_at'>): string {
  return todayIn(COMPANY_TIME_ZONE, new Date(problem.created_at));
}

/** Who holds the live repair — the person the card shows — or null. */
export function problemHolder(problem: Pick<Problem, 'fix_tasks'>): string | null {
  return liveFixTask(problem)?.assignee_id ?? null;
}

/**
 * The house a task stands in: its own listing, or the house of the room it
 * stands on — the same split the card's place makes (`splitPlace`). A part of
 * a combined listing is a listing of its own, as the property tree has it.
 */
function houseOf(problem: Pick<Problem, 'property'>): string | null {
  return problem.property ? splitPlace(problem.property).building : null;
}

function matchesPlace(problem: Problem, place: PlaceFilter): boolean {
  switch (place.kind) {
    case 'all':
      return true;
    case 'none':
      return problemPlace(problem) === null;
    case 'place':
      // A room by the place its card shows; a house by itself and its rooms.
      return problemPlace(problem) === place.name || houseOf(problem) === place.name;
  }
}

/**
 * The head technician's rule on the phone (`features/board/schema.ts`): a
 * person matches what he holds now, and a closed task waits for nobody.
 */
function matchesAssignee(problem: Problem, assigneeId: string): boolean {
  if (assigneeId === ANY_ASSIGNEE) {
    return true;
  }
  if (assigneeId === NO_ASSIGNEE) {
    return !isProblemClosed(problem) && problemHolder(problem) === null;
  }
  return problemHolder(problem) === assigneeId;
}

function matchesDates(problem: Problem, from: string, to: string): boolean {
  if (from === '' && to === '') {
    return true;
  }
  // `YYYY-MM-DD` sorts as it reads, so a string compare is a date compare.
  const day = reportedDay(problem);
  return (from === '' || day >= from) && (to === '' || day <= to);
}

export function matchesProblemFilters(problem: Problem, filters: ProblemFilters): boolean {
  return (
    matchesPlace(problem, filters.place) &&
    matchesAssignee(problem, filters.assigneeId) &&
    matchesDates(problem, filters.dateFrom, filters.dateTo) &&
    matchesQuery(problem, filters.query)
  );
}

/** One line of the listing filter: a house, or a room under it, as the cards name it. */
export interface PlaceOption {
  name: string;
  isRoom: boolean;
}

// "Unit 3" before "Unit 10", as the property tree counts (lib/property-tree.ts).
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Every place a task stands on: each house once, in the order a person counts,
 * followed by those of its rooms that have a task. A house is offered even when
 * only its rooms have tasks — choosing it takes them all.
 */
export function placeOptions(problems: readonly Problem[]): PlaceOption[] {
  const rooms = new Map<string, Set<string>>();
  for (const problem of problems) {
    if (problem.property) {
      const { building, room } = splitPlace(problem.property);
      const known = rooms.get(building) ?? new Set<string>();
      rooms.set(building, room === null ? known : new Set([...known, room]));
    }
  }
  return [...rooms.keys()]
    .sort(collator.compare)
    .flatMap((building) => [
      { name: building, isRoom: false },
      ...[...(rooms.get(building) ?? [])]
        .sort(collator.compare)
        .map((room) => ({ name: propertyPath(building, room), isRoom: true })),
    ]);
}

/** One line of the person filter; the name is null when nobody joined it. */
export interface AssigneeOption {
  id: string;
  name: string | null;
}

/**
 * The people on a live repair, once each, by name — read off the tasks loaded,
 * so the list holds only who has something now. The person already chosen
 * stays while any repair names him: filtered by Petr, the manager closing
 * Petr's last repair must not get the whole board back unasked.
 */
export function assigneeOptions(problems: readonly Problem[], chosenId: string): AssigneeOption[] {
  const names = new Map<string, string | null>();
  for (const problem of problems) {
    const live = liveFixTask(problem);
    for (const task of problem.fix_tasks) {
      const id = task.assignee_id;
      if (id !== null && (task === live || id === chosenId)) {
        names.set(id, task.assignee?.full_name ?? names.get(id) ?? null);
      }
    }
  }
  return [...names]
    .map(([id, name]) => ({ id, name }))
    .sort(
      (left, right) =>
        // Somebody whose name did not come along goes last.
        Number(left.name === null) - Number(right.name === null) ||
        collator.compare(left.name ?? '', right.name ?? '') ||
        left.id.localeCompare(right.id),
    );
}

/**
 * The filters with what no task names set aside: an old or hand-edited link
 * keeps the rest, rather than showing an empty screen for a reason the bar
 * cannot show. «Без объекта» and «Не назначено» always stand.
 */
export function knownFilters(
  filters: ProblemFilters,
  places: readonly PlaceOption[],
  people: readonly AssigneeOption[],
): ProblemFilters {
  const { place, assigneeId } = filters;
  const isPlaceKnown =
    place.kind !== 'place' || places.some((option) => option.name === place.name);
  const isPersonKnown =
    assigneeId === ANY_ASSIGNEE ||
    assigneeId === NO_ASSIGNEE ||
    people.some((person) => person.id === assigneeId);
  return {
    ...filters,
    place: isPlaceKnown ? place : ANY_PLACE,
    assigneeId: isPersonKnown ? assigneeId : ANY_ASSIGNEE,
  };
}
