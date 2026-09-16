'use client';

import { useTranslation } from 'react-i18next';

export type MediaSource = 'camera' | 'gallery' | 'unknown';

interface PhotoSourceProps {
  source: MediaSource;
}

/**
 * Where the app said this photo came from.
 *
 * Shown only when it is not the camera, because a mark on every photo is a
 * mark nobody reads. What it means has to stay exact: the server cannot see a
 * camera, so this is what the app declared, not what happened. 'unknown' is a
 * build that predates the column — worth showing precisely because it is the
 * case where nothing was declared at all.
 *
 * Words, not a colour: the manager reads this on a phone in a corridor, and a
 * coloured corner tells a colour-blind reader nothing.
 */
export function PhotoSource({ source }: PhotoSourceProps) {
  const { t } = useTranslation();

  if (source === 'camera') {
    return null;
  }

  return (
    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-center text-[10px] leading-tight text-white">
      {source === 'gallery' ? t('panel.media.fromGallery') : t('panel.media.sourceUnknown')}
    </span>
  );
}
