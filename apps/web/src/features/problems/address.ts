import { z } from 'zod';

import {
  ANY_PLACE,
  EMPTY_PROBLEM_FILTERS,
  NO_ASSIGNEE,
  NO_PLACE,
  withOrderedDates,
  type PlaceFilter,
  type ProblemFilters,
} from './filters';

/** The views of «Задания», in their tabs' order; the board is the default. */
export const PROBLEM_VIEWS = ['board', 'list', 'archive'] as const;
export type ProblemView = (typeof PROBLEM_VIEWS)[number];

/**
 * What «Задания» keep in their address: the view (owner, 05.10) and the
 * search and filters (owner, 10.10). A change of view is a step «Назад» walks
 * back; a filter is changed in place, as in «Уборки» (owner, 04.10). A task's
 * page carries all of it, so «К списку заданий» returns to the view as it was.
 */
export interface ProblemsAddress {
  view: ProblemView;
  filters: ProblemFilters;
}

const DEFAULT_VIEW: ProblemView = 'board';

/** The names in the query, short because a manager may read and forward the link. */
const PARAM = {
  view: 'view',
  query: 'q',
  place: 'place',
  assignee: 'assignee',
  dateFrom: 'from',
  dateTo: 'to',
} as const;

const viewSchema = z.enum(PROBLEM_VIEWS);
/** A person's id, or the live tasks nobody holds. */
const assigneeSchema = z.union([z.literal(NO_ASSIGNEE), z.uuid()]);
const daySchema = z.iso.date();

/** A view as an address names it; anything else — or nothing — is the board. */
export function readProblemsView(value: unknown): ProblemView {
  const parsed = viewSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_VIEW;
}

/**
 * A listing's name can be anything, so «Без объекта» is the parameter with no
 * name at all (`place=`) rather than a word some listing could be called.
 */
function readPlace(value: string | null): PlaceFilter {
  if (value === null) {
    return ANY_PLACE;
  }
  return value === '' ? NO_PLACE : { kind: 'place', name: value };
}

function writePlace(place: PlaceFilter): string | null {
  switch (place.kind) {
    case 'all':
      return null;
    case 'none':
      return '';
    case 'place':
      return place.name;
  }
}

/**
 * The address as the screen's state. Each value is checked on its own: an old
 * or hand-edited link loses the part that makes no sense and keeps the rest,
 * rather than failing the screen; two days the wrong way round are the days
 * between them. Whether a place or a person is one some task names is known
 * only once the tasks are read (`knownFilters`).
 */
export function readProblemsAddress(params: URLSearchParams): ProblemsAddress {
  const valid = <T>(schema: z.ZodType<T>, name: string, fallback: T): T => {
    const parsed = schema.safeParse(params.get(name));
    return parsed.success ? parsed.data : fallback;
  };
  return {
    view: readProblemsView(params.get(PARAM.view)),
    filters: withOrderedDates({
      query: params.get(PARAM.query) ?? EMPTY_PROBLEM_FILTERS.query,
      place: readPlace(params.get(PARAM.place)),
      assigneeId: valid(assigneeSchema, PARAM.assignee, EMPTY_PROBLEM_FILTERS.assigneeId),
      dateFrom: valid(daySchema, PARAM.dateFrom, EMPTY_PROBLEM_FILTERS.dateFrom),
      dateTo: valid(daySchema, PARAM.dateTo, EMPTY_PROBLEM_FILTERS.dateTo),
    }),
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeProblemsAddress({ view, filters }: ProblemsAddress): string {
  const entries: [string, string | null][] = [
    [PARAM.view, view === DEFAULT_VIEW ? null : view],
    [PARAM.query, filters.query.trim() === '' ? null : filters.query],
    [PARAM.place, writePlace(filters.place)],
    [
      PARAM.assignee,
      filters.assigneeId === EMPTY_PROBLEM_FILTERS.assigneeId ? null : filters.assigneeId,
    ],
    [PARAM.dateFrom, filters.dateFrom === '' ? null : filters.dateFrom],
    [PARAM.dateTo, filters.dateTo === '' ? null : filters.dateTo],
  ];
  return new URLSearchParams(
    entries.flatMap(([name, value]) => (value === null ? [] : [[name, value]])),
  ).toString();
}

/** Where a link comes from: a view alone, or a view with its filters. */
export type ProblemsFrom = ProblemView | ProblemsAddress;

function addressOf(from: ProblemsFrom): ProblemsAddress {
  return typeof from === 'string' ? { view: from, filters: EMPTY_PROBLEM_FILTERS } : from;
}

function withAddress(path: string, from: ProblemsFrom): string {
  const search = writeProblemsAddress(addressOf(from));
  return search === '' ? path : `${path}?${search}`;
}

/** A task's page, carrying the view — and the filters — it is opened from. */
export function problemHref(id: string, from: ProblemsFrom): string {
  return withAddress(`/problems/${id}`, from);
}

/**
 * What a task's page keeps in its address: the view of «Задания» it was
 * opened from with its filters, and whether the conversation is open beside
 * it (5.4, «Чат», variant B). A link with `chat=1` opens the page with the
 * conversation open.
 */
export interface ProblemPageAddress extends ProblemsAddress {
  chat: boolean;
}

const CHAT_PARAM = 'chat';
const CHAT_OPEN = '1';

export function readProblemPageAddress(params: URLSearchParams): ProblemPageAddress {
  return { ...readProblemsAddress(params), chat: params.get(CHAT_PARAM) === CHAT_OPEN };
}

/** The query for the state, without its `?`: the view and filters first, then the conversation. */
export function writeProblemPageAddress({ view, filters, chat }: ProblemPageAddress): string {
  const params = new URLSearchParams(writeProblemsAddress({ view, filters }));
  if (chat) {
    params.set(CHAT_PARAM, CHAT_OPEN);
  }
  return params.toString();
}

/** A task's page with its conversation open: where the mark «Новое сообщение» leads. */
export function problemChatHref(id: string, from: ProblemsFrom): string {
  return `/problems/${id}?${writeProblemPageAddress({ ...addressOf(from), chat: true })}`;
}

/** The section on one of its views, with its filters. */
export function problemsHref(from: ProblemsFrom): string {
  return withAddress('/problems', from);
}
