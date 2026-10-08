import { z } from 'zod';

/** The views of «Задания», in their tabs' order; the board is the default. */
export const PROBLEM_VIEWS = ['board', 'list', 'archive'] as const;
export type ProblemView = (typeof PROBLEM_VIEWS)[number];

/**
 * What «Задания» keep in their address (owner, 05.10): the view. A change of
 * view is a step «Назад» walks back, and a task's page carries the view it
 * was opened from, so «К списку заданий» returns to it.
 */
export interface ProblemsAddress {
  view: ProblemView;
}

const DEFAULT_VIEW: ProblemView = 'board';
const VIEW_PARAM = 'view';
const viewSchema = z.enum(PROBLEM_VIEWS);

/** A view as an address names it; anything else — or nothing — is the board. */
export function readProblemsView(value: unknown): ProblemView {
  const parsed = viewSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_VIEW;
}

export function readProblemsAddress(params: URLSearchParams): ProblemsAddress {
  return { view: readProblemsView(params.get(VIEW_PARAM)) };
}

/** The query for the state, without its `?`: empty for the board. */
export function writeProblemsAddress({ view }: ProblemsAddress): string {
  return view === DEFAULT_VIEW ? '' : new URLSearchParams({ [VIEW_PARAM]: view }).toString();
}

function withView(path: string, view: ProblemView): string {
  const search = writeProblemsAddress({ view });
  return search === '' ? path : `${path}?${search}`;
}

/** A task's page, carrying the view it is opened from. */
export function problemHref(id: string, view: ProblemView): string {
  return withView(`/problems/${id}`, view);
}

/**
 * What a task's page keeps in its address: the view of «Задания» it was
 * opened from, and whether the conversation is open beside it (5.4, «Чат»,
 * variant B). A link with `chat=1` opens the page with the conversation open.
 */
export interface ProblemPageAddress {
  view: ProblemView;
  chat: boolean;
}

const CHAT_PARAM = 'chat';
const CHAT_OPEN = '1';

export function readProblemPageAddress(params: URLSearchParams): ProblemPageAddress {
  return { ...readProblemsAddress(params), chat: params.get(CHAT_PARAM) === CHAT_OPEN };
}

/** The query for the state, without its `?`: the view first, then the conversation. */
export function writeProblemPageAddress({ view, chat }: ProblemPageAddress): string {
  const params = new URLSearchParams(writeProblemsAddress({ view }));
  if (chat) {
    params.set(CHAT_PARAM, CHAT_OPEN);
  }
  return params.toString();
}

/** A task's page with its conversation open: where the mark «Новое сообщение» leads. */
export function problemChatHref(id: string, view: ProblemView): string {
  return `/problems/${id}?${writeProblemPageAddress({ view, chat: true })}`;
}

/** The section on one of its views. */
export function problemsHref(view: ProblemView): string {
  return withView('/problems', view);
}
