/**
 * How a place is written when it is a room inside a house.
 *
 * The rule was written twice — once for the phone, once for the panel — and a
 * third caller made that a decision waiting to drift. What a cleaner reports
 * and what a manager searches for have to be spelled the same way, down to the
 * dash, or the panel's search stops finding the phone's reports.
 *
 * An em dash with spaces, not a hyphen: room names are already full of
 * hyphens ("1 - 2109"), and a second one would blur where the house ends.
 */
export const PROPERTY_PATH_SEPARATOR = ' — ';

/** The house, or the house and the room inside it, as one line. */
export function propertyPath(building: string, room: string | null): string {
  return room === null ? building : `${building}${PROPERTY_PATH_SEPARATOR}${room}`;
}
