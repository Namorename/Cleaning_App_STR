import { describe, expect, test } from 'vitest';

import {
  clampView,
  doubleClickScale,
  fitScale,
  fitView,
  isZoomedIn,
  MAX_SCALE,
  panBy,
  refitView,
  wheelPixels,
  wheelScale,
  zoomTo,
} from '../zoom';

/**
 * The arithmetic of a photo in the viewer: a 4000×3000 phone photo on a
 * 1000×600 stage fits at 20 %, and every zoom and drag keeps it on the stage.
 */

const PHOTO = { width: 4000, height: 3000 };
const STAGE = { width: 1000, height: 600 };

describe('fitted', () => {
  test('is the whole picture on the stage, never larger than its own size', () => {
    expect(fitScale(PHOTO, STAGE)).toBeCloseTo(0.2);
    expect(fitScale({ width: 400, height: 300 }, STAGE)).toBe(1);
  });

  test('is centred', () => {
    expect(fitView(PHOTO, STAGE)).toEqual({ scale: 0.2, x: 100, y: 0 });
  });

  test('a picture not yet measured counts as 100 %', () => {
    expect(fitScale({ width: 0, height: 0 }, STAGE)).toBe(1);
  });
});

describe('zooming', () => {
  test('keeps the point under the cursor where it was', () => {
    const fitted = fitView(PHOTO, STAGE);
    const at = { x: 300, y: 200 };
    const zoomed = zoomTo(fitted, 1, at, PHOTO, STAGE);

    // The picture point under the cursor before…
    const before = { x: (at.x - fitted.x) / fitted.scale, y: (at.y - fitted.y) / fitted.scale };
    // …is the picture point under it after.
    expect((at.x - zoomed.x) / zoomed.scale).toBeCloseTo(before.x);
    expect((at.y - zoomed.y) / zoomed.scale).toBeCloseTo(before.y);
  });

  test('goes no closer than four times the natural size, and no further out than fitted', () => {
    const fitted = fitView(PHOTO, STAGE);

    expect(zoomTo(fitted, 50, { x: 0, y: 0 }, PHOTO, STAGE).scale).toBe(MAX_SCALE);
    expect(zoomTo(fitted, 0.01, { x: 0, y: 0 }, PHOTO, STAGE)).toEqual(fitted);
  });

  test('a wheel turned up zooms in, turned down zooms out', () => {
    expect(wheelScale(1, -100)).toBeGreaterThan(1);
    expect(wheelScale(1, 100)).toBeLessThan(1);
  });

  // Firefox counts a notched mouse in lines (±3), Chrome in pixels (±100).
  test('a notch counted in lines zooms about as far as one counted in pixels', () => {
    expect(wheelPixels(-3, 1, 800)).toBe(-48);
    expect(wheelPixels(-100, 0, 800)).toBe(-100);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });

  test('a double click goes to 100 % from fitted, and back to fitted from any zoom', () => {
    const fitted = fitView(PHOTO, STAGE);
    expect(doubleClickScale(fitted, PHOTO, STAGE)).toBe(1);

    const zoomed = zoomTo(fitted, 0.5, { x: 500, y: 300 }, PHOTO, STAGE);
    expect(doubleClickScale(zoomed, PHOTO, STAGE)).toBeCloseTo(0.2);
  });

  test('a small picture, already at 100 % when fitted, doubles on a double click', () => {
    const small = { width: 400, height: 300 };
    expect(doubleClickScale(fitView(small, STAGE), small, STAGE)).toBe(2);
  });
});

describe('dragging', () => {
  test('moves the picture, but never pulls its edge inside the stage', () => {
    const zoomed = zoomTo(fitView(PHOTO, STAGE), 1, { x: 500, y: 300 }, PHOTO, STAGE);

    const right = panBy(zoomed, 100_000, 0, PHOTO, STAGE);
    expect(right.x).toBe(0);
    const left = panBy(zoomed, -100_000, 0, PHOTO, STAGE);
    expect(left.x).toBe(STAGE.width - PHOTO.width);
  });

  test('a side shorter than the stage stays centred', () => {
    const view = clampView({ scale: 0.25, x: -500, y: -500 }, PHOTO, STAGE);
    // 4000 × 0.25 = 1000 wide: exactly the stage; 3000 × 0.25 = 750 high: taller.
    expect(view.x).toBe(0);
    expect(view.y).toBe(-150);
  });

  test('a window resized keeps a zoom on the stage, and fits one that no longer reaches', () => {
    const zoomed = zoomTo(fitView(PHOTO, STAGE), 1, { x: 500, y: 300 }, PHOTO, STAGE);
    const wide = { width: 5000, height: 4000 };

    expect(refitView(null, PHOTO, wide)).toBeNull();
    expect(refitView({ ...zoomed, x: -3000 }, PHOTO, { width: 2000, height: 1200 })?.x).toBe(
      -2000,
    );
    // On a stage the photo fits at 100 %, a 100 % view is simply fitted.
    expect(refitView(zoomed, PHOTO, wide)).toBeNull();
  });

  test('a fitted picture is not zoomed in, a closer one is', () => {
    const fitted = fitView(PHOTO, STAGE);
    expect(isZoomedIn(fitted, PHOTO, STAGE)).toBe(false);
    expect(isZoomedIn({ ...fitted, scale: 0.3 }, PHOTO, STAGE)).toBe(true);
  });
});
