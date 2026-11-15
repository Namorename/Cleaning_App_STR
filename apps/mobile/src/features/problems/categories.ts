import { foldForSearch, problemLevel, problemLevelRank, type ProblemLevel } from '@str-ops/shared';
import { z } from 'zod';

import { localizedText } from '@/features/steps/schema';

import { PROBLEM_PRIORITIES } from './schema';

/**
 * A category of the company's catalogue (problem_categories, 20261115100000):
 * what a cleaner picks instead of typing a title when the company reports by
 * catalogue (hosts.problem_report_mode). The name is in the company's language
 * with its translations beside it; the synonyms are words she may type for it.
 *
 * The urgency is shown, never sent: the server files the task with the
 * category's own. One a newer server spells differently reads as unknown —
 * the category stays pickable, without its chip — rather than emptying the list.
 */
export const problemCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  name_i18n: z.record(z.string(), z.string()).catch({}),
  synonyms: z.array(z.string()).catch([]),
  priority: z.enum(PROBLEM_PRIORITIES).nullable().catch(null),
  // The level above high (20261115090000), over priority `high`; absent reads not critical.
  critical: z.boolean().catch(false).optional(),
});

export type ProblemCategory = z.infer<typeof problemCategorySchema>;
export const problemCategoryListSchema = z.array(problemCategorySchema);

/** The level a task of this category gets, on the scale of four; null when it could not be read. */
export function categoryLevel(
  category: Pick<ProblemCategory, 'priority' | 'critical'>,
): ProblemLevel | null {
  return category.priority === null
    ? null
    : problemLevel({ priority: category.priority, critical: category.critical });
}

/** The category's name in her language, or the company's words when it has no translation. */
export function categoryName(
  category: Pick<ProblemCategory, 'name' | 'name_i18n'>,
  language: string,
): string {
  return localizedText(category.name, category.name_i18n, language);
}

/**
 * What separates the words of a name or of what she types: spaces and
 * punctuation. «Wi-Fi» is two words, «Доставка (бельё, химия…)» five.
 */
const WORD_BREAK = /[\s\-‐‑‒–—―.,;:!?()[\]{}«»"'‘’„“”…/\\|+&*_#№@<>=%$~]+/;

function wordsOf(text: string): string[] {
  return foldForSearch(text)
    .split(WORD_BREAK)
    .filter((word) => word !== '');
}

/**
 * The words of a name, and the name run together when it has more than one:
 * «Wi-Fi» is found by «wi», «fi» and «wifi», whatever synonyms the company
 * gave it.
 */
function indexWordsOf(text: string): string[] {
  const words = wordsOf(text);
  return words.length > 1 ? [...words, words.join('')] : words;
}

/** A category with the words the search compares, folded once rather than on every key. */
export interface IndexedCategory {
  readonly category: ProblemCategory;
  readonly words: readonly string[];
}

/**
 * Every word a category may be found by: its name in the company's language,
 * each translation and each synonym — a cleaner on an English screen may still
 * type «кран».
 */
/**
 * The order she picks from (owner, 2026-11-15): the least urgent on top — low, normal, high —
 * and critical at the very bottom; within a level the catalogue's own order (the sort is stable).
 * A category whose urgency could not be read leads, as one with none.
 */
export function inPickOrder(categories: readonly ProblemCategory[]): ProblemCategory[] {
  const rank = (category: ProblemCategory) => {
    const level = categoryLevel(category);
    return level === null ? 0 : problemLevelRank(level);
  };
  return [...categories].sort((left, right) => rank(left) - rank(right));
}

export function indexCategories(categories: readonly ProblemCategory[]): IndexedCategory[] {
  return categories.map((category) => ({
    category,
    words: [category.name, ...Object.values(category.name_i18n), ...category.synonyms].flatMap(
      indexWordsOf,
    ),
  }));
}

/**
 * The categories she means, in the catalogue's order: each word she typed is
 * the beginning of some word of the category, case aside and ё read as е
 * (`foldForSearch`). «элек» finds «Электричество полностью» and «Частичное
 * отсутствие электричества»; «гор вод» finds «Горячая вода»; «кран» finds
 * «Смесители» by its synonym. Nothing typed keeps them all.
 */
export function matchCategories(
  index: readonly IndexedCategory[],
  query: string,
): ProblemCategory[] {
  const typed = wordsOf(query);
  return index
    .filter(({ words }) => typed.every((token) => words.some((word) => word.startsWith(token))))
    .map(({ category }) => category);
}
