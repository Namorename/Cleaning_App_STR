import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { readCached } from '@/lib/read-cached';

import { fetchReportProperties } from './api';
import { propertyKeys } from './keys';
import { reportPropertyListSchema, type ReportProperty } from './schema';

/**
 * The list restored from disk is in the shape the build that saved it read
 * (`readCached`): the unit id changed type since the picker first shipped.
 * Read through the schema, an unreadable list is a short error, not a picker
 * that breaks on the first room.
 */
function readPlaces(data: unknown): ReportProperty[] {
  return readCached(reportPropertyListSchema, data, 'report places');
}

/**
 * Which listings change hands in a day: none. An hour is generous.
 *
 * The cache is on disk, so a phone that has read the list once still has it in
 * a stairwell with no signal — which is where a broken tap gets reported.
 */
const FRESH_FOR_MS = 60 * 60 * 1000;

export function useReportProperties(): UseQueryResult<ReportProperty[], Error> {
  return useQuery({
    queryKey: propertyKeys.reportable(),
    queryFn: fetchReportProperties,
    select: readPlaces,
    staleTime: FRESH_FOR_MS,
  });
}
