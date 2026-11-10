/** Query keys for everything the plans read. */
export const planKeys = {
  all: ['plans'] as const,
  plan: (planId: string) => ['plans', 'plan', planId] as const,
  effect: (planId: string) => ['plans', 'effect', planId] as const,
  place: (placeId: number) => ['plans', 'place', placeId] as const,
};
