import { foldForSearch } from '../search';
import { problemLevel, problemLevelRank, type ProblemLevel, type StoredUrgency } from './level';

/**
 * Picking a task's category from the company's catalogue (problem_categories, 20261115100000;
 * hosts.problem_report_mode = 'catalog'): the order of the list and the search over it.
 *
 * The rules are the phone's (`apps/mobile/src/features/problems/categories.ts`, owner
 * 2026-11-15), so a manager in the panel and a cleaner on the phone see the same list in the same
 * order and find a category by the same letters. The phone keeps its own copy until a build of it
 * reads this one; its test `categories-parity.test.ts` holds the two to the same answers.
 *
 * Imported by its path (`@str-ops/shared/src/problems/categories`), not through the package's
 * index: the phone bundles everything the index names, and a module only the panel reads must
 * not change what the phones download.
 */

/** What a category must carry to be ordered and searched. */
export interface CatalogCategory {
  readonly id: string;
  /** In the company's language. */
  readonly name: string;
  readonly name_i18n: Readonly<Record<string, string>>;
  /** Words to find it by, any language. */
  readonly synonyms: readonly string[];
  /** Null when it could not be read: the category stays pickable, without its level. */
  readonly priority: StoredUrgency['priority'] | null;
  /** The level above high, over priority `high` (20261115090000). */
  readonly critical?: boolean | null;
}

/** The level a task of this category gets, on the scale of four; null when it could not be read. */
export function categoryLevel(
  category: Pick<CatalogCategory, 'priority' | 'critical'>,
): ProblemLevel | null {
  return category.priority === null
    ? null
    : problemLevel({ priority: category.priority, critical: category.critical });
}

/** The category's name in the reader's language, or the company's words when it has no translation. */
export function categoryName(
  category: Pick<CatalogCategory, 'name' | 'name_i18n'>,
  language: string,
): string {
  const translated = category.name_i18n[language];
  return translated !== undefined && translated.trim() !== '' ? translated : category.name;
}

/**
 * What separates the words of a name or of what is typed: spaces and punctuation. «Wi-Fi» is two
 * words, «Доставка (бельё, химия…)» five.
 */
const WORD_BREAK = /[\s\-‐‑‒–—―.,;:!?()[\]{}«»"'‘’„“”…/\\|+&*_#№@<>=%$~]+/;

function wordsOf(text: string): string[] {
  return foldForSearch(text)
    .split(WORD_BREAK)
    .filter((word) => word !== '');
}

/**
 * The words of a name, and the name run together when it has more than one: «Wi-Fi» is found by
 * «wi», «fi» and «wifi», whatever synonyms the company gave it.
 */
function indexWordsOf(text: string): string[] {
  const words = wordsOf(text);
  return words.length > 1 ? [...words, words.join('')] : words;
}

/** A category with the words the search compares, folded once rather than on every key. */
export interface IndexedCategory<C extends CatalogCategory = CatalogCategory> {
  readonly category: C;
  readonly words: readonly string[];
}

/**
 * The order a category is picked from (owner, 2026-11-15): the least urgent on top — low, normal,
 * high — and critical at the very bottom; within a level the catalogue's own order, kept by the
 * index rather than left to the engine's sort. A category whose urgency could not be read leads,
 * as one with none.
 */
export function inPickOrder<C extends CatalogCategory>(categories: readonly C[]): C[] {
  const rank = (category: C) => {
    const level = categoryLevel(category);
    return level === null ? 0 : problemLevelRank(level);
  };
  return categories
    .map((category, at) => ({ category, at, rank: rank(category) }))
    .sort((left, right) => left.rank - right.rank || left.at - right.at)
    .map(({ category }) => category);
}

/**
 * Every word a category may be found by: its name in the company's language, each translation
 * and each synonym — a manager on an English screen may still type «кран».
 */
export function indexCategories<C extends CatalogCategory>(
  categories: readonly C[],
): IndexedCategory<C>[] {
  return categories.map((category) => ({
    category,
    words: [category.name, ...Object.values(category.name_i18n), ...category.synonyms].flatMap(
      indexWordsOf,
    ),
  }));
}

/**
 * The categories meant, in the index's order (the picker's, `inPickOrder`): each word typed is the
 * beginning of some word of the category, case aside and ё read as е (`foldForSearch`). «элек»
 * finds «Электричество полностью» and «Частичное отсутствие электричества»; «гор вод» finds
 * «Горячая вода»; «кран» finds «Смесители» by its synonym. Nothing typed keeps them all.
 */
export function matchCategories<C extends CatalogCategory>(
  index: readonly IndexedCategory<C>[],
  query: string,
): C[] {
  const typed = wordsOf(query);
  return index
    .filter(({ words }) => typed.every((token) => words.some((word) => word.startsWith(token))))
    .map(({ category }) => category);
}
