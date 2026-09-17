import { propertyPath, splitPlace } from '@str-ops/shared';
import { z } from 'zod';

/**
 * A place a report can be filed about.
 *
 * The rows come from the `report_properties` view, which holds exactly what
 * the writer will accept — her own listings and the rooms inside them. The
 * phone does no filtering of its own: a list assembled here from `properties`
 * would have to restate the rule, and the weaker copy is the one an
 * intercepted request would meet.
 */
export const reportPropertySchema = z.object({
  id: z.number(),
  name: z.string(),
  parent_id: z.number().nullable(),
  // `bigint`, and PostgREST serialises it as a JSON number — not a string.
  // Declared as a string this field threw on every room row, and because the
  // list is parsed with `z.array`, one room took the whole picker down with
  // it: the cleaner saw an error instead of her places on exactly the nine
  // listings that have rooms. Nothing caught it — the fixtures in the test are
  // typed objects that never reach `parse`.
  hostaway_unit_id: z.number().nullable(),
  parent_name: z.string().nullable(),
});

export type ReportProperty = z.infer<typeof reportPropertySchema>;

export const reportPropertyListSchema = z.array(reportPropertySchema);

/**
 * What this place is called, in one line.
 *
 * A room is named after the house it is in, because its own name ("1 - 2109")
 * names no house and a manager reading the report would have to look it up.
 * A room is a row with a `hostaway_unit_id`, never merely a row with a parent:
 * `parent_id` also links a part of a combined listing, which is a listing of
 * its own and must keep its own name.
 */
export function propertyLabel(property: ReportProperty): string {
  // The view hands out flat columns, so the row is shaped for the shared
  // labeller rather than the roomness test being written again here.
  const { building, room } = splitPlace({
    name: property.name,
    hostaway_unit_id: property.hostaway_unit_id,
    parent: property.parent_name === null ? null : { name: property.parent_name },
  });

  return propertyPath(building, room);
}

/** The places whose label holds every word typed, in any order. */
export function filterProperties(
  properties: readonly ReportProperty[],
  query: string,
): ReportProperty[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...properties];
  }
  return properties.filter((property) => {
    const label = propertyLabel(property).toLowerCase();
    return words.every((word) => label.includes(word));
  });
}
