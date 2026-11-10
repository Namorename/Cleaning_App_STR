import type { FindingTab, SignalKind } from './schema';

/**
 * Query keys for everything the «Гости» section reads. Apart from its hooks:
 * the problem page's «Ложное срабатывание» moves a finding and the menu's
 * count too, and refreshes them without reaching into the section's reads.
 */
export const signalKeys = {
  all: ['guest-signals'] as const,
  findings: (tab: FindingTab, kinds: readonly SignalKind[] = ['review']) =>
    ['guest-signals', 'findings', tab, kinds.join(',')] as const,
  count: (kinds: readonly SignalKind[] = ['review']) =>
    ['guest-signals', 'count', kinds.join(',')] as const,
  /** A page of «Все отзывы» under one set of filters (`reviewFiltersKey`). */
  reviews: (filters: string, page: number) => ['guest-signals', 'reviews', filters, page] as const,
  place: (findingId: string) => ['guest-signals', 'place', findingId] as const,
  settings: () => ['guest-signals', 'settings'] as const,
  runs: (kind: SignalKind = 'review') => ['guest-signals', 'runs', kind] as const,
  /** Whether chats are on: their cards, counts and line follow it. */
  chats: () => ['guest-signals', 'chats'] as const,
};

/**
 * A review's text read from the PMS on the fly. Not under `signalKeys.all`:
 * a decision refreshes the section, and that must not read every opened
 * text again — each read counts against the person's limit.
 */
export const reviewTextKey = (signalId: string) => ['guest-review-text', signalId] as const;
