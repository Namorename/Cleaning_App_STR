/**
 * Reading a list that is longer than one PostgREST response.
 *
 * The server cuts every response at its max-rows setting — the hosted default
 * is a thousand — and says nothing when it does: a reader that asks once gets
 * the first thousand rows and a 200. The Tasks screen did exactly that and,
 * sorted by date over a month of expired duplicates, stopped weeks before
 * today (docs/f10-plan.md, stage 7.0).
 *
 * The first page is asked with an exact count. It also tells the real cap: if
 * fewer rows came back than were asked for and than exist, the server cuts
 * harder than we do, and every later page is that size — stepping on by the
 * asked size would skip rows without a word. The rest of the pages are then
 * known in advance and read in parallel, a few at a time, so the number of
 * requests is bounded and nothing can loop. A row that moves between two
 * pages (a booking cancelled by a webhook mid-read) is left for the next
 * refetch; rows are merged by id, so one that shifts the other way is not
 * shown twice.
 */

/** What one page request answers: the shape of a supabase-js response. */
export interface Page<T> {
  data: T[] | null;
  error: unknown;
  count?: number | null;
}

/**
 * Asks for rows `from..to` (inclusive, the way `.range()` counts). The count
 * is asked for only when `withCount` is set: a count on every page would cost
 * a count query each time, and PostgREST answers 416 to a counted page that
 * starts past a total that shrank meanwhile.
 */
export type PageRequest<T> = (from: number, to: number, withCount: boolean) => PromiseLike<Page<T>>;

const PAGE_SIZE = 500;
const MAX_PARALLEL = 4;
/** Without a count the end is only known from a short page; this is the backstop. */
const MAX_UNCOUNTED_REQUESTS = 20;

function unwrap<T>(page: Page<T>): T[] {
  if (page.error) {
    throw page.error;
  }
  return page.data ?? [];
}

/**
 * The id a row is merged by. Every list read this way selects `id`; the row
 * type is not constrained because supabase-js cannot type a select string
 * with embeds, so the rule is kept at run time instead — a row without an id
 * fails the read rather than being merged by value.
 */
function keyOf(row: unknown): unknown {
  if (typeof row === 'object' && row !== null && 'id' in row) {
    return (row as { id: unknown }).id;
  }
  throw new Error('fetchAllPages: every row must carry an id to be merged across pages');
}

/** The pages in server order, each row once. */
function merge<T>(pages: readonly (readonly T[])[]): T[] {
  const seen = new Set<unknown>();
  return pages.flat().filter((row) => {
    const key = keyOf(row);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function readUncounted<T>(request: PageRequest<T>, first: T[], size: number): Promise<T[]> {
  const pages: T[][] = [first];
  let offset = first.length;
  let last = first;
  while (last.length === size) {
    if (pages.length >= MAX_UNCOUNTED_REQUESTS) {
      throw new Error(
        `fetchAllPages: request limit of ${MAX_UNCOUNTED_REQUESTS} pages reached without a count`,
      );
    }
    last = unwrap(await request(offset, offset + size - 1, false));
    pages.push(last);
    offset += last.length;
  }
  return merge(pages);
}

async function readInBatches<T>(
  request: PageRequest<T>,
  offsets: readonly number[],
  size: number,
): Promise<T[][]> {
  const pages: T[][] = [];
  for (let start = 0; start < offsets.length; start += MAX_PARALLEL) {
    const batch = offsets.slice(start, start + MAX_PARALLEL);
    const answers = await Promise.all(batch.map((from) => request(from, from + size - 1, false)));
    pages.push(...answers.map((answer) => unwrap(answer)));
  }
  return pages;
}

/**
 * Every row the request can see. The query behind `request` must be sorted to
 * a unique column last (`id`): with ties, pages overlap and miss rows.
 */
export async function fetchAllPages<T>(request: PageRequest<T>): Promise<T[]> {
  const answer = await request(0, PAGE_SIZE - 1, true);
  const first = unwrap(answer);
  const total = answer.count;

  if (total === null || total === undefined) {
    return readUncounted(request, first, PAGE_SIZE);
  }
  if (first.length === 0 || first.length >= total) {
    return merge([first]);
  }

  const size = first.length < PAGE_SIZE ? first.length : PAGE_SIZE;
  const offsets: number[] = [];
  for (let from = first.length; from < total; from += size) {
    offsets.push(from);
  }
  const rest = await readInBatches(request, offsets, size);
  return merge([first, ...rest]);
}
