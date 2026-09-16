import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { fetchReportProperties } from './api';
import { propertyKeys } from './keys';
import { type ReportProperty } from './schema';

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
    staleTime: FRESH_FOR_MS,
  });
}
