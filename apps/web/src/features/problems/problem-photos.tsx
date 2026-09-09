'use client';

import { useTranslation } from 'react-i18next';

import type { Photo } from './api';

interface ProblemPhotosProps {
  photos: Photo[];
  /** What to say when there is nothing to show. */
  emptyText: string;
}

/** Thumbnails that open the full photo in a new tab. */
export function ProblemPhotos({ photos, emptyText }: ProblemPhotosProps) {
  const { t } = useTranslation();

  if (photos.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {photos.map((photo, index) => (
        <li key={photo.id}>
          {photo.url === null ? (
            <span className="flex size-24 items-center justify-center rounded-md border text-xs text-muted-foreground">
              {t('problems.noPhotos')}
            </span>
          ) : (
            <a href={photo.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage links */}
              <img
                src={photo.url}
                alt={`${t('panel.problems.detail.photos')} ${index + 1}`}
                className="size-24 rounded-md border object-cover"
                loading="lazy"
              />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
