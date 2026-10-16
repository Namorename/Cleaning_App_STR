/**
 * The arithmetic of the Analytics charts, apart from their drawing: the
 * page's charts are its own SVG and HTML (docs/dashboard-metrics.md, 4.3 —
 * no chart library), and the same numbers could draw them anywhere else.
 */

/** A round top for an axis that holds `max`: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= max) ?? 10;
  return step * power;
}

/** The ticks of an axis from 0 to `top`, `count` intervals, whole numbers only. */
export function ticks(top: number, count = 4): number[] {
  const step = top / count;
  const values = Array.from({ length: count + 1 }, (_, at) => at * step);
  return values.every(Number.isInteger) ? values : [0, top];
}

/** A value's share of the axis, 0–1, for a bar's length. */
export function share(value: number, top: number): number {
  if (top <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / top));
}
