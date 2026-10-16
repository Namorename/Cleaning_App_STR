'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { downloadCsv, downloadXlsx } from '@/lib/export-table';
import { useSupabase } from '@/lib/supabase/use-client';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

import { fetchWholeTable } from './api';
import { COLUMNS, exportFileName, exportRows, type Column, type ColumnContext } from './columns';
import { formatNumber } from './format';
import type { Period } from './period';
import type { AnalyticsQuery, AnalyticsRows, AnalyticsTable as TableName, NameMode } from './schema';
import { useAnalyticsTable } from './use-analytics';

/** Rows on a page of a table on the screen. */
export const TABLE_PAGE_SIZE = 25;

interface AnalyticsTableProps {
  table: TableName;
  query: AnalyticsQuery;
  period: Period;
  names: NameMode;
}

function rowKey(row: AnalyticsRows[TableName], index: number): string {
  if ('person_id' in row) {
    return row.person_id;
  }
  return row.listing_id === null ? `none-${index}` : String(row.listing_id);
}

/**
 * One table of the page, a page at a time, and the whole of it as a
 * spreadsheet: the export reads every page from the server, so it holds what
 * the filters hold, not only what is on the screen.
 */
export function AnalyticsTable({ table, query, period, names }: AnalyticsTableProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const client = useSupabase();
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState<unknown>(null);
  const read = useAnalyticsTable(table, query, { limit: TABLE_PAGE_SIZE, offset });

  const context: ColumnContext = { language, names, t: (key) => t(key) };
  const columns = COLUMNS[table] as readonly Column<AnalyticsRows[TableName]>[];
  const title = t(`panel.analytics.tables.${table}`);

  const download = async (kind: 'csv' | 'xlsx') => {
    setExporting(kind);
    setExportError(null);
    try {
      const rows = exportRows(table, await fetchWholeTable(client, table, query), context);
      if (kind === 'csv') {
        downloadCsv(exportFileName(table, period, 'csv'), rows);
      } else {
        downloadXlsx(exportFileName(table, period, 'xlsx'), title.slice(0, 31), rows);
      }
    } catch (error: unknown) {
      setExportError(error);
    } finally {
      setExporting(null);
    }
  };

  if (read.isError) {
    return <ErrorState message={t('panel.analytics.errors.table')} error={read.error} />;
  }
  if (read.data === undefined) {
    return <LoadingState>…</LoadingState>;
  }

  const { rows, total } = read.data;
  // A page that emptied under a later read (fewer rows now): back to the first.
  if (rows.length === 0 && offset > 0 && !read.isPlaceholderData) {
    setOffset(0);
  }
  const first = total === 0 ? 0 : offset + 1;
  const last = offset + rows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={total === 0 || exporting !== null}
          onClick={() => void download('csv')}
        >
          {t('panel.analytics.export.csv')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11"
          disabled={total === 0 || exporting !== null}
          onClick={() => void download('xlsx')}
        >
          {t('panel.analytics.export.xlsx')}
        </Button>
      </div>
      {exportError === null ? null : (
        <ErrorState message={t('panel.analytics.export.failed')} error={exportError} />
      )}

      {rows.length === 0 ? (
        <EmptyState>{t('panel.analytics.empty.table')}</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableCaption className="sr-only">{title}</TableCaption>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead
                    key={column.key}
                    scope="col"
                    className={cn('whitespace-normal', column.numeric && 'text-right')}
                  >
                    {t(column.header)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={rowKey(row, index)}>
                  {columns.map((column, at) =>
                    at === 0 ? (
                      <TableHead key={column.key} scope="row" className="font-normal">
                        {column.text(row, context)}
                      </TableHead>
                    ) : (
                      <TableCell
                        key={column.key}
                        className={cn(column.numeric && 'text-right tabular-nums')}
                      >
                        {column.text(row, context)}
                      </TableCell>
                    ),
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > TABLE_PAGE_SIZE ? (
        <nav
          aria-label={title}
          className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"
        >
          <span>
            {t('panel.analytics.pagination.range', {
              from: formatNumber(first, language),
              to: formatNumber(last, language),
              total: formatNumber(total, language),
            })}
          </span>
          <span className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - TABLE_PAGE_SIZE))}
            >
              {t('panel.analytics.pagination.previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={last >= total}
              onClick={() => setOffset(offset + TABLE_PAGE_SIZE)}
            >
              {t('panel.analytics.pagination.next')}
            </Button>
          </span>
        </nav>
      ) : null}
    </div>
  );
}
