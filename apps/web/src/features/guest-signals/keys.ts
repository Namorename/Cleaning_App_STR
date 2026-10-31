import type { FindingTab } from './schema';

/**
 * Query keys for everything the «Гости» section reads. Apart from its hooks:
 * the problem page's «Ложное срабатывание» moves a finding and the menu's
 * count too, and refreshes them without reaching into the section's reads.
 */
export const signalKeys = {
  all: ['guest-signals'] as const,
  findings: (tab: FindingTab) => ['guest-signals', 'findings', tab] as const,
  count: () => ['guest-signals', 'count'] as const,
  list: () => ['guest-signals', 'list'] as const,
  place: (findingId: string) => ['guest-signals', 'place', findingId] as const,
  settings: () => ['guest-signals', 'settings'] as const,
  runs: () => ['guest-signals', 'runs'] as const,
};
