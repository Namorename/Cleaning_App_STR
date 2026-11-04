import { useEffect, useState, type ComponentType } from 'react';

import { reportError } from '@/lib/sentry';

import type { PhotoViewerProps } from './photo-viewer';

type Viewer = ComponentType<PhotoViewerProps>;

let loaded: Viewer | null = null;
/** A module that failed once is not tried again in this run: one report, not one per tap. */
let hasFailed = false;

/**
 * The viewer's module, evaluated on the first tap rather than at start.
 *
 * It brings the gesture handler and Reanimated: both are in the native build
 * since 1.2.0 (dab5237), but no screen ran either before this update. Loaded
 * here, a fault in one of them stays inside the viewer — reported, and the
 * tap does nothing — instead of stopping the app at start for everyone. The
 * module is in the bundle either way: Metro follows a `require` as it follows
 * an import.
 */
function loadViewer(): Viewer {
  if (loaded === null) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const viewer = require('./photo-viewer') as typeof import('./photo-viewer');
    loaded = viewer.PhotoViewer;
  }
  return loaded;
}

function tryLoadViewer(): Viewer | null {
  if (hasFailed) {
    return null;
  }
  try {
    return loadViewer();
  } catch (error: unknown) {
    hasFailed = true;
    reportError(error);
    return null;
  }
}

/** The viewer of a row's photos, for a tile to open (photo-viewer.tsx). */
export function PhotoViewerHost(props: PhotoViewerProps) {
  const [viewer] = useState(tryLoadViewer);
  const { onClose } = props;

  useEffect(() => {
    if (viewer === null) {
      onClose();
    }
  }, [viewer, onClose]);

  if (viewer === null) {
    return null;
  }
  const LoadedViewer = viewer;
  return <LoadedViewer {...props} />;
}
