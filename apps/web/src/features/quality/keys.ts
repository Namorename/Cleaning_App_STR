import type { QualityWindow } from '@str-ops/shared';

/** Query keys for everything «Качество объектов» reads. */
export const qualityKeys = {
  all: ['quality'] as const,
  overview: (window: QualityWindow) => ['quality', 'overview', window] as const,
  areas: (window: QualityWindow) => ['quality', 'areas', window] as const,
  place: (placeId: number, window: QualityWindow) => ['quality', 'place', placeId, window] as const,
};
