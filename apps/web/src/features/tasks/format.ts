/** `HH:MM:SS` from the database as `HH:MM`. */
export function formatClock(time: string): string {
  return time.slice(0, 5);
}

/** The window as one line: "10:00 – 12:00", "с 10:00", "до 12:00", or nothing. */
export function formatWindow(
  timeFrom: string | null,
  timeTo: string | null,
  labels: { from: (time: string) => string; until: (time: string) => string },
): string | null {
  if (timeFrom !== null && timeTo !== null) {
    return `${formatClock(timeFrom)} – ${formatClock(timeTo)}`;
  }
  if (timeFrom !== null) {
    return labels.from(formatClock(timeFrom));
  }
  if (timeTo !== null) {
    return labels.until(formatClock(timeTo));
  }
  return null;
}

/** Minutes as "1 ч 25 мин" needs grammar; the panel asks for the parts. */
export function splitMinutes(minutes: number): { hours: number; minutes: number } {
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
