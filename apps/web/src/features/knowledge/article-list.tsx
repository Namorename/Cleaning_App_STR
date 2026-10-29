'use client';

import { SUPPORTED_LANGUAGES } from '@str-ops/shared';
import Link from 'next/link';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { LabelledField } from '@/components/labelled-field';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { KB_STATUS_FILTERS, type KbPlaceFilter, type KbStatusFilter } from './address';
import { articleTouchesPlace, placeLabel, type PlaceIndex } from './places';
import type { ArticleRow, Place } from './schema';

/** How many places a row names before it says how many more there are. */
const PLACES_NAMED = 2;

/** The rows the filters keep: the status asked for (drafts and published by default), the place. */
export function filterArticles(
  rows: readonly ArticleRow[],
  status: KbStatusFilter,
  place: KbPlaceFilter,
  index: PlaceIndex,
): ArticleRow[] {
  return rows.filter((row) => {
    const statusOk = status === 'current' ? row.status !== 'archived' : row.status === status;
    const placeOk =
      place === null
        ? true
        : place === 'company'
          ? row.scope === 'company'
          : articleTouchesPlace(
              row.targets.map((target) => target.property_id),
              place,
              index,
            );
    return statusOk && placeOk;
  });
}

interface ArticleFiltersProps {
  status: KbStatusFilter;
  place: KbPlaceFilter;
  places: readonly Place[];
  index: PlaceIndex;
  onStatusChange: (status: KbStatusFilter) => void;
  onPlaceChange: (place: KbPlaceFilter) => void;
}

/** The status and the place: the two ways the owner asked to narrow the list. */
export function ArticleFilters({
  status,
  place,
  places,
  index,
  onStatusChange,
  onPlaceChange,
}: ArticleFiltersProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const options = places
    .map((one) => ({ id: one.id, label: placeLabel(index, one.id) ?? one.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <LabelledField id={`${baseId}-status`} label={t('panel.knowledge.filters.status')}>
        <NativeSelect
          id={`${baseId}-status`}
          value={status}
          onChange={(event) => {
            const next = KB_STATUS_FILTERS.find((value) => value === event.target.value);
            if (next !== undefined) {
              onStatusChange(next);
            }
          }}
        >
          {KB_STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {t(`panel.knowledge.statusFilter.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </LabelledField>
      <LabelledField id={`${baseId}-place`} label={t('panel.knowledge.filters.place')}>
        <NativeSelect
          id={`${baseId}-place`}
          className="max-w-full sm:w-80"
          value={place === null ? '' : String(place)}
          onChange={(event) => {
            const value = event.target.value;
            onPlaceChange(value === '' ? null : value === 'company' ? 'company' : Number(value));
          }}
        >
          <option value="">{t('panel.knowledge.filters.anyPlace')}</option>
          <option value="company">{t('panel.knowledge.filters.company')}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </LabelledField>
    </div>
  );
}

/** Where a row shows, in words: the company, or its places by name. */
function WhereCell({ row, index }: { row: ArticleRow; index: PlaceIndex }) {
  const { t } = useTranslation();
  if (row.scope === 'company') {
    return <>{t('panel.knowledge.where.company')}</>;
  }
  const names = row.targets.flatMap((target) => {
    const label = placeLabel(index, target.property_id);
    return label === null ? [] : [label];
  });
  const hidden = row.targets.length - names.length;
  if (row.targets.length === 0) {
    return <span className="text-muted-foreground">{t('panel.knowledge.where.none')}</span>;
  }
  return (
    <span className="flex flex-col">
      <span>
        {names.slice(0, PLACES_NAMED).join(', ')}
        {names.length > PLACES_NAMED
          ? ` ${t('panel.knowledge.where.more', { count: names.length - PLACES_NAMED })}`
          : null}
      </span>
      {hidden > 0 ? (
        <span className="text-xs text-muted-foreground">
          {t('panel.knowledge.where.hidden', { count: hidden })}
        </span>
      ) : null}
    </span>
  );
}

interface ArticleListProps {
  rows: readonly ArticleRow[];
  /** Any article at all, before the filters: an empty company and an empty filter say different things. */
  hasAny: boolean;
  index: PlaceIndex;
  hrefOf: (id: string) => string;
  onOpen: (id: string) => void;
}

export function ArticleList({ rows, hasAny, index, hrefOf, onOpen }: ArticleListProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  if (rows.length === 0) {
    return (
      <EmptyState className="rounded-lg border border-dashed p-6 text-center">
        {hasAny ? t('panel.knowledge.emptyFiltered') : t('panel.knowledge.empty')}
      </EmptyState>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('panel.knowledge.columns.title')}</TableHead>
            <TableHead>{t('panel.knowledge.columns.status')}</TableHead>
            <TableHead>{t('panel.knowledge.columns.where')}</TableHead>
            <TableHead>{t('panel.knowledge.columns.languages')}</TableHead>
            <TableHead>{t('panel.knowledge.columns.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const translated = new Set(row.translations.map((one) => one.language));
            return (
              <TableRow key={row.id}>
                <TableCell className="max-w-80 whitespace-normal">
                  <Link
                    href={hrefOf(row.id)}
                    lang={row.language}
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                        return;
                      }
                      event.preventDefault();
                      onOpen(row.id);
                    }}
                  >
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={row.status === 'published' ? 'default' : 'outline'}>
                    {t(`panel.knowledge.status.${row.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <WhereCell row={row} index={index} />
                </TableCell>
                <TableCell>
                  <span className="flex gap-1">
                    {SUPPORTED_LANGUAGES.filter(
                      (code) => code === row.language || translated.has(code),
                    ).map((code) => (
                      <Badge
                        key={code}
                        variant={code === row.language ? 'secondary' : 'outline'}
                        title={
                          code === row.language
                            ? `${t(`panel.knowledge.languages.${code}`)} · ${t('panel.knowledge.originalMark')}`
                            : t(`panel.knowledge.languages.${code}`)
                        }
                      >
                        {code.toUpperCase()}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(row.updated_at, language)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
