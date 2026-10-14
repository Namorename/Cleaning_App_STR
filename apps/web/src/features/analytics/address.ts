import { Constants } from '@str-ops/shared';
import { z } from 'zod';

import { isValidPeriod, PERIOD_PRESETS, presetPeriod, type Period, type PeriodPreset } from './period';
import {
  ANALYTICS_TABLES,
  NAME_MODES,
  NO_FILTERS,
  type AnalyticsFilters,
  type AnalyticsTable,
  type NameMode,
  type ProblemPriority,
  type ProblemStatus,
  type TaskStatus,
} from './schema';

/**
 * What the Analytics page keeps in its address: the period (a quick choice,
 * counted from today when the link is opened, or two days of its own), the
 * comparison, how names are shown, the demo listings, the open table and the
 * filters. A link, a bookmark and «Назад» open the page as it was left.
 */
export interface AnalyticsAddress {
  /** Null when the period is two days of its own. */
  preset: PeriodPreset | null;
  custom: Period | null;
  compare: boolean;
  names: NameMode;
  includeTest: boolean;
  table: AnalyticsTable;
  filters: AnalyticsFilters;
}

export const DEFAULT_ANALYTICS_ADDRESS: AnalyticsAddress = {
  preset: '30d',
  custom: null,
  compare: true,
  names: 'full',
  includeTest: false,
  table: 'cleaningsByProperty',
  filters: NO_FILTERS,
};

/** Short names: a manager may read and forward the link. */
const PARAM = {
  preset: 'p',
  from: 'from',
  to: 'to',
  compare: 'cmp',
  names: 'names',
  includeTest: 'test',
  table: 'tab',
  properties: 'prop',
  people: 'ppl',
  taskStatuses: 'st',
  problemStatuses: 'pst',
  priorities: 'urg',
} as const;

const presetSchema = z.enum(PERIOD_PRESETS);
const tableSchema = z.enum(ANALYTICS_TABLES);
const nameSchema = z.enum(NAME_MODES);
const daySchema = z.iso.date();
const propertyIdSchema = z.coerce.number().int().positive();
const personIdSchema = z.uuid();
const taskStatusSchema = z.enum(Constants.public.Enums.task_status);
const problemStatusSchema = z.enum(Constants.public.Enums.problem_status);
const prioritySchema = z.enum(Constants.public.Enums.problem_priority);

/** The values of a comma list that the schema accepts, in order, without repeats. */
function listOf<T>(raw: string | null, schema: z.ZodType<T>): T[] {
  if (raw === null || raw === '') {
    return [];
  }
  const values = raw
    .split(',')
    .map((part) => schema.safeParse(part.trim()))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data as T);
  return [...new Set(values)];
}

/**
 * The address as the page's state. Each value is checked on its own: an old
 * or hand-edited link loses the part that makes no sense and keeps the rest.
 */
export function readAnalyticsAddress(params: URLSearchParams): AnalyticsAddress {
  const valid = <T>(schema: z.ZodType<T>, name: string, fallback: T): T => {
    const parsed = schema.safeParse(params.get(name));
    return parsed.success ? parsed.data : fallback;
  };

  const from = daySchema.safeParse(params.get(PARAM.from));
  const to = daySchema.safeParse(params.get(PARAM.to));
  const custom =
    from.success && to.success && isValidPeriod({ from: from.data, to: to.data })
      ? { from: from.data, to: to.data }
      : null;

  return {
    preset: custom === null ? valid(presetSchema, PARAM.preset, '30d' as PeriodPreset) : null,
    custom,
    compare: params.get(PARAM.compare) !== '0',
    names: valid(nameSchema, PARAM.names, DEFAULT_ANALYTICS_ADDRESS.names),
    includeTest: params.get(PARAM.includeTest) === '1',
    table: valid(tableSchema, PARAM.table, DEFAULT_ANALYTICS_ADDRESS.table),
    filters: {
      propertyIds: listOf<number>(params.get(PARAM.properties), propertyIdSchema),
      personIds: listOf<string>(params.get(PARAM.people), personIdSchema),
      taskStatuses: listOf<TaskStatus>(params.get(PARAM.taskStatuses), taskStatusSchema),
      problemStatuses: listOf<ProblemStatus>(params.get(PARAM.problemStatuses), problemStatusSchema),
      priorities: listOf<ProblemPriority>(params.get(PARAM.priorities), prioritySchema),
    },
  };
}

/** The query for the state, without its `?`: only what differs from the defaults. */
export function writeAnalyticsAddress(address: AnalyticsAddress): string {
  const { filters } = address;
  const entries: [string, string][] = [
    [
      PARAM.preset,
      address.custom === null && address.preset !== DEFAULT_ANALYTICS_ADDRESS.preset
        ? (address.preset ?? '')
        : '',
    ],
    [PARAM.from, address.custom?.from ?? ''],
    [PARAM.to, address.custom?.to ?? ''],
    [PARAM.compare, address.compare ? '' : '0'],
    [PARAM.names, address.names === DEFAULT_ANALYTICS_ADDRESS.names ? '' : address.names],
    [PARAM.includeTest, address.includeTest ? '1' : ''],
    [PARAM.table, address.table === DEFAULT_ANALYTICS_ADDRESS.table ? '' : address.table],
    [PARAM.properties, filters.propertyIds.join(',')],
    [PARAM.people, filters.personIds.join(',')],
    [PARAM.taskStatuses, filters.taskStatuses.join(',')],
    [PARAM.problemStatuses, filters.problemStatuses.join(',')],
    [PARAM.priorities, filters.priorities.join(',')],
  ];
  // URLSearchParams' own encoding: useAddressState matches its echo by it.
  return new URLSearchParams(entries.filter(([, value]) => value !== '')).toString();
}

/** The days the address means today: a quick choice is counted from `today`. */
export function resolvePeriod(address: AnalyticsAddress, today: string): Period {
  return address.custom ?? presetPeriod(address.preset ?? '30d', today);
}
