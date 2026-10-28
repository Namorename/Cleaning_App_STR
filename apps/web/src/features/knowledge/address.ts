import { z } from 'zod';

/** What the list shows: drafts and published together, or one status. */
export const KB_STATUS_FILTERS = ['current', 'draft', 'published', 'archived'] as const;
export type KbStatusFilter = (typeof KB_STATUS_FILTERS)[number];

/** The articles of one place, the whole company's, or (null) all of them. */
export type KbPlaceFilter = 'company' | number | null;

/**
 * What «База знаний» keeps in its address (the owner's rule of 04.10 for every
 * list): the status, the place, and the article open — `new` for one being
 * written. A link, a bookmark and «Назад» open the screen as it was left.
 */
export interface KnowledgeAddress {
  status: KbStatusFilter;
  place: KbPlaceFilter;
  article: string | null;
}

export const DEFAULT_KNOWLEDGE_ADDRESS: KnowledgeAddress = {
  status: 'current',
  place: null,
  article: null,
};

export const NEW_ARTICLE = 'new';

const PARAM = { status: 'status', place: 'place', article: 'article' } as const;

const statusSchema = z.enum(KB_STATUS_FILTERS);
const placeSchema = z.union([
  z.literal('company'),
  z
    .string()
    .regex(/^\d{1,15}$/)
    .transform(Number),
]);
/** An article's id is minted as a UUID; the database writes it in small letters. */
const articleSchema = z.union([
  z.literal(NEW_ARTICLE),
  z.uuid().transform((id) => id.toLowerCase()),
]);

/** The address as the screen's state; each part that makes no sense is dropped alone. */
export function readKnowledgeAddress(params: URLSearchParams): KnowledgeAddress {
  const valid = <T>(schema: z.ZodType<T, unknown>, name: string, fallback: T): T => {
    const parsed = schema.safeParse(params.get(name));
    return parsed.success ? parsed.data : fallback;
  };
  return {
    status: valid(statusSchema, PARAM.status, DEFAULT_KNOWLEDGE_ADDRESS.status),
    place: valid(placeSchema, PARAM.place, DEFAULT_KNOWLEDGE_ADDRESS.place),
    article: valid(articleSchema, PARAM.article, DEFAULT_KNOWLEDGE_ADDRESS.article),
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeKnowledgeAddress({ status, place, article }: KnowledgeAddress): string {
  const entries: [string, string][] = [
    [PARAM.status, status === DEFAULT_KNOWLEDGE_ADDRESS.status ? '' : status],
    [PARAM.place, place === null ? '' : String(place)],
    [PARAM.article, article ?? ''],
  ];
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}
