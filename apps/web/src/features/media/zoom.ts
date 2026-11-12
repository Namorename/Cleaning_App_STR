/**
 * The arithmetic of a photo zoomed and moved inside the viewer.
 *
 * The picture is laid out at its natural size from the stage's top left
 * corner and moved by `translate(x, y) scale(scale)` with the origin there:
 * `scale` is the share of the natural size on screen (1 is 100 %), `x` and
 * `y` where its corner stands. Pure, so every rule is tested without a page.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ZoomView {
  scale: number;
  x: number;
  y: number;
}

/** The closest it gets: four times the natural size. */
export const MAX_SCALE = 4;
/** One press of «+» or «−». */
export const ZOOM_STEP = 1.5;
/** How fast a wheel zooms, per pixel of its travel. */
const WHEEL_RATE = 0.0015;
/** Below this the picture counts as fitted, not zoomed. */
const EPSILON = 0.001;

const hasArea = (size: Size): boolean => size.width > 0 && size.height > 0;

/** The scale at which the whole picture fits the stage; never larger than 100 %. */
export function fitScale(image: Size, stage: Size): number {
  if (!hasArea(image) || !hasArea(stage)) {
    return 1;
  }
  return Math.min(stage.width / image.width, stage.height / image.height, 1);
}

/** Where one side of the picture may stand: centred when it is shorter than the stage. */
function placeAlong(position: number, length: number, room: number): number {
  if (length <= room) {
    return (room - length) / 2;
  }
  return Math.min(0, Math.max(room - length, position));
}

/**
 * The view as it may be: the scale between fitted and the closest, and the
 * picture never pulled off the stage — a side shorter than the stage stays
 * centred, a longer one keeps its edges outside the stage's.
 */
export function clampView(view: ZoomView, image: Size, stage: Size): ZoomView {
  const lowest = fitScale(image, stage);
  const scale = Math.min(Math.max(view.scale, lowest), Math.max(MAX_SCALE, lowest));
  return {
    scale,
    x: placeAlong(view.x, image.width * scale, stage.width),
    y: placeAlong(view.y, image.height * scale, stage.height),
  };
}

/** The whole picture, centred. */
export function fitView(image: Size, stage: Size): ZoomView {
  return clampView({ scale: fitScale(image, stage), x: 0, y: 0 }, image, stage);
}

/** A new scale, with the point under the cursor (or the fingers) left where it was. */
export function zoomTo(
  view: ZoomView,
  scale: number,
  around: Point,
  image: Size,
  stage: Size,
): ZoomView {
  const ratio = scale / view.scale;
  return clampView(
    {
      scale,
      x: around.x - (around.x - view.x) * ratio,
      y: around.y - (around.y - view.y) * ratio,
    },
    image,
    stage,
  );
}

/** The view moved by a drag. */
export function panBy(view: ZoomView, dx: number, dy: number, image: Size, stage: Size): ZoomView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, stage);
}

/** The scale a wheel's travel leads to: down zooms out, up zooms in. */
export function wheelScale(scale: number, deltaY: number): number {
  return scale * Math.exp(-deltaY * WHEEL_RATE);
}

/** `WheelEvent.deltaMode`: the travel in pixels, in lines, or in pages. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
/** A line of travel, as the browsers that count in pixels measure one. */
const LINE_PX = 16;

/**
 * A wheel's travel in pixels. Firefox counts a notched mouse in lines (±3
 * a notch) where Chrome counts pixels (±100): without this a notch zoomed
 * Firefox by half a per cent.
 */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === DOM_DELTA_LINE) {
    return deltaY * LINE_PX;
  }
  return deltaMode === DOM_DELTA_PAGE ? deltaY * pageHeight : deltaY;
}

/** Whether the picture is closer than fitted — and can be dragged. */
export function isZoomedIn(view: ZoomView, image: Size, stage: Size): boolean {
  return view.scale > fitScale(image, stage) + EPSILON;
}

/**
 * Where a double click leads: back to fitted from any zoom, and from fitted
 * to 100 % — or twice the size when 100 % is what fitted already is.
 */
export function doubleClickScale(view: ZoomView, image: Size, stage: Size): number {
  const fit = fitScale(image, stage);
  if (isZoomedIn(view, image, stage)) {
    return fit;
  }
  return fit < 1 ? 1 : fit * 2;
}

/**
 * The view after the stage changed size (a window resized, a phone turned):
 * kept on the stage, and fitted again when it no longer reaches past fitted.
 */
export function refitView(view: ZoomView | null, image: Size, stage: Size): ZoomView | null {
  if (view === null) {
    return null;
  }
  const kept = clampView(view, image, stage);
  return isZoomedIn(kept, image, stage) ? kept : null;
}

/** The middle of the stage, for a zoom that has no cursor to keep still. */
export function centreOf(stage: Size): Point {
  return { x: stage.width / 2, y: stage.height / 2 };
}
