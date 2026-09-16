import { propertyPath } from '@str-ops/shared';
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
  hostaway_unit_id: z.string().nullable(),
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
  const isRoom = property.hostaway_unit_id !== null && property.parent_name !== null;
  return isRoom ? propertyPath(property.parent_name ?? '', property.name) : property.name;
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
