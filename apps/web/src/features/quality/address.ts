import { DEFAULT_QUALITY_WINDOW, isQualityWindow, type QualityWindow } from '@str-ops/shared';

/** What the overview keeps in its address: a link, a bookmark and «Назад» find it as it was. */
export interface QualityAddress {
  window: QualityWindow;
  /** Null: every city. */
  city: string | null;
  onlyNew: boolean;
}

export const DEFAULT_QUALITY_ADDRESS: QualityAddress = {
  window: DEFAULT_QUALITY_WINDOW,
  city: null,
  onlyNew: false,
};

/** Short names: a manager may read and forward the link. */
const PARAM = { window: 'w', city: 'city', onlyNew: 'new' } as const;

/** The window of an address; one that makes no sense gives way to the main window. */
export function readQualityWindow(params: URLSearchParams): QualityWindow {
  const window = params.get(PARAM.window);
  return isQualityWindow(window) ? window : DEFAULT_QUALITY_WINDOW;
}

/** The query of a screen that keeps only its window, without its `?`. */
export function writeQualityWindow(window: QualityWindow): string {
  return writeQualityAddress({ ...DEFAULT_QUALITY_ADDRESS, window });
}

export function readQualityAddress(params: URLSearchParams): QualityAddress {
  const city = params.get(PARAM.city);
  return {
    window: readQualityWindow(params),
    city: city === null || city === '' ? null : city,
    onlyNew: params.get(PARAM.onlyNew) === '1',
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeQualityAddress({ window, city, onlyNew }: QualityAddress): string {
  const entries: [string, string][] = [
    [PARAM.window, window === DEFAULT_QUALITY_WINDOW ? '' : window],
    [PARAM.city, city ?? ''],
    [PARAM.onlyNew, onlyNew ? '1' : ''],
  ];
  // URLSearchParams' own encoding: useAddressState matches its echo by it.
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}

function withQuery(path: string, query: string): string {
  return query === '' ? path : `${path}?${query}`;
}

/** The overview in a window: where a card's way back leads. */
export function qualityHref(window: QualityWindow): string {
  return withQuery('/quality', writeQualityWindow(window));
}

/** The areas in a window: the overview's link keeps the one it stands in. */
export function qualityAreasHref(window: QualityWindow): string {
  return withQuery('/quality/areas', writeQualityWindow(window));
}

/** A place's card in the window it was opened from. */
export function qualityPlaceHref(placeId: number, window: QualityWindow): string {
  return withQuery(`/quality/${placeId}`, writeQualityWindow(window));
}
