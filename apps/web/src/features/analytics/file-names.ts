import type { Period } from './period';
import type { AnalyticsFilters, AnalyticsTable } from './schema';

/**
 * The names of the files the Analytics page hands over (owner, 2026-10-16):
 * the report or the table, the period, and the listing or person filter —
 * in Latin letters whatever the page's language, never a person's name, no
 * space or sign Windows refuses, at most MAX_FILE_NAME long.
 *
 *   woom-analytics-report_2026-10-01_to_2026-10-31.pdf
 *   woom-analytics_cleanings-by-cleaner_2026-10-13_person-5e000000.csv
 */

/** A reasonable length for a file name: long enough for every part, short for any disk. */
export const MAX_FILE_NAME = 120;

/** What a file's name tells. */
export interface FileNameScope {
  period: Period;
  filters: Pick<AnalyticsFilters, 'propertyIds' | 'personIds'>;
  /** A listing's own name, as stored — not the chip's, which is in the page's language. */
  listingName: (id: number) => string | undefined;
}

/** The tables by the words a person reads: problems are «tasks» (docs/rename-table.md). */
const TABLE_NAMES: Record<AnalyticsTable, string> = {
  cleaningsByProperty: 'cleanings-by-property',
  cleaningsByCleaner: 'cleanings-by-cleaner',
  checkoutsByProperty: 'checkouts-by-property',
  problemsByProperty: 'tasks-by-property',
  problemsByTechnician: 'tasks-by-technician',
};

/** A person in a name: the start of the id, never the name. */
const PERSON_ID_LENGTH = 8;

/** Letters without a Latin form after their marks are taken off. */
const LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h',
  ß: 'ss', ł: 'l', đ: 'd', ø: 'o', æ: 'ae', œ: 'oe', þ: 'th',
};

/**
 * Lower-case Latin letters, digits and single hyphens: Czech and German
 * letters lose their marks, Cyrillic is written in Latin (a letter stored as
 * a base and a mark joined first, so «и» + breve is «й»), anything else is a
 * break between words.
 */
export function slugOf(text: string): string {
  const latin = [...text.normalize('NFC').toLowerCase()]
    .map((letter) => LATIN[letter] ?? letter)
    .join('');
  return latin
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** One date for one day, else from and to. */
function periodPart({ from, to }: Period): string {
  return from === to ? from : `${from}_to_${to}`;
}

/** The listing part: its name made Latin, its number when no name is left, a count for several. */
function listingPart(scope: FileNameScope): { prefix: string; slug: string } | null {
  const ids = scope.filters.propertyIds;
  if (ids.length === 0) {
    return null;
  }
  if (ids.length > 1) {
    return { prefix: '_properties-', slug: String(ids.length) };
  }
  const slug = slugOf(scope.listingName(ids[0]) ?? '');
  return { prefix: '_property-', slug: slug === '' ? String(ids[0]) : slug };
}

function personPart(scope: FileNameScope): string {
  const ids = scope.filters.personIds;
  if (ids.length === 0) {
    return '';
  }
  return ids.length === 1
    ? `_person-${slugOf(ids[0].slice(0, PERSON_ID_LENGTH))}`
    : `_people-${ids.length}`;
}

/**
 * The name from its parts. Too long, the listing's name is cut — never the
 * period, the person or the extension — and ends on a whole letter.
 */
function fileName(head: string, scope: FileNameScope, extension: string): string {
  const listing = listingPart(scope);
  const tail = `${personPart(scope)}.${extension}`;
  const start = `${head}_${periodPart(scope.period)}`;
  if (listing === null) {
    return `${start}${tail}`;
  }
  const room = MAX_FILE_NAME - start.length - listing.prefix.length - tail.length;
  const slug = listing.slug.slice(0, Math.max(room, 1)).replace(/-+$/, '');
  return `${start}${listing.prefix}${slug}${tail}`;
}

/** "woom-analytics-report_2026-10-01_to_2026-10-31_property-zizkov-attic.pdf" */
export function reportPdfName(scope: FileNameScope): string {
  return fileName('woom-analytics-report', scope, 'pdf');
}

/** "woom-analytics_tasks-by-property_2026-10-01_to_2026-10-31.xlsx" */
export function tableFileName(
  table: AnalyticsTable,
  scope: FileNameScope,
  extension: 'csv' | 'xlsx',
): string {
  return fileName(`woom-analytics_${TABLE_NAMES[table]}`, scope, extension);
}
