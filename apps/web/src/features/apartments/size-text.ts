import type { TFunction } from 'i18next';

/**
 * A listing's size as the info tab shows it: "2 bedrooms, up to 4 guests".
 *
 * Two counted phrases in one frame, each agreeing with its own number: one
 * sentence cannot, since i18next picks a plural form from a single count.
 * A number Hostaway left out reads as none, as it always has.
 */
export function sizeText(t: TFunction, bedrooms: number | null, guests: number | null): string {
  return t('panel.apartments.info.sizeValue', {
    bedrooms: t('panel.apartments.info.bedrooms', { count: bedrooms ?? 0 }),
    guests: t('panel.apartments.info.guestsUpTo', { count: guests ?? 0 }),
  });
}
