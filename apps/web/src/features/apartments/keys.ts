/** Query keys for everything the registry reads. */
export const apartmentKeys = {
  all: ['apartments'] as const,
  registry: () => ['apartments', 'registry'] as const,
  openCleanings: () => ['apartments', 'open-cleanings'] as const,
  one: (id: number) => ['apartments', 'one', id] as const,
};
