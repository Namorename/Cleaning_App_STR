'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toCsv, type CellValue } from '@/lib/csv';
import { downloadFile } from '@/lib/download';
import { todayIso } from '@/lib/format-date';
import { XLSX_MIME, xlsxBytes } from '@/lib/xlsx';

import {
  aggregatePurchase,
  DEFAULT_PURCHASE_SCOPE,
  PURCHASE_SCOPE_STATUSES,
  type SupplyRequest,
  type SupplyStatus,
} from './schema';

interface PurchaseSummaryProps {
  requests: SupplyRequest[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The same items across requests, added up, with the two files a supplier takes. */
export function PurchaseSummary({ requests, open, onOpenChange }: PurchaseSummaryProps) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<readonly SupplyStatus[]>(DEFAULT_PURCHASE_SCOPE);
  const lines = aggregatePurchase(requests, scope);

  const toggle = (status: SupplyStatus) =>
    setScope((current) =>
      current.includes(status) ? current.filter((s) => s !== status) : [...current, status],
    );

  const sourceText = (sources: (string | null)[]) =>
    sources.map((source) => source ?? t('panel.supplies.summary.general')).join('; ');

  const rows: CellValue[][] = [
    [
      t('panel.supplies.summary.columns.name'),
      t('panel.supplies.summary.columns.unit'),
      t('panel.supplies.summary.columns.quantity'),
      t('panel.supplies.summary.columns.properties'),
      t('panel.supplies.summary.columns.requests'),
    ],
    ...lines.map((line) => [
      line.name,
      t(`supplies.units.${line.unit}`),
      line.quantity,
      sourceText(line.sources),
      line.requestCount,
    ]),
  ];

  const downloadCsv = () =>
    downloadFile(
      `purchase-${todayIso()}.csv`,
      new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }),
    );
  const downloadXlsx = () =>
    downloadFile(
      `purchase-${todayIso()}.xlsx`,
      new Blob([new Uint8Array(xlsxBytes(t('panel.supplies.summary.sheet'), rows))], {
        type: XLSX_MIME,
      }),
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('panel.supplies.summary.title')}</DialogTitle>
          <DialogDescription>{t('panel.supplies.summary.description')}</DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-wrap items-center gap-4 text-sm">
          <legend className="sr-only">{t('panel.supplies.summary.scope')}</legend>
          <span className="text-muted-foreground">{t('panel.supplies.summary.scope')}:</span>
          {PURCHASE_SCOPE_STATUSES.map((status) => (
            <label key={status} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={scope.includes(status)}
                onChange={() => toggle(status)}
              />
              {t(`supplies.statuses.${status}`)}
            </label>
          ))}
        </fieldset>

        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('panel.supplies.summary.empty')}</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('panel.supplies.summary.columns.name')}</TableHead>
                  <TableHead>{t('panel.supplies.summary.columns.unit')}</TableHead>
                  <TableHead>{t('panel.supplies.summary.columns.quantity')}</TableHead>
                  <TableHead>{t('panel.supplies.summary.columns.properties')}</TableHead>
                  <TableHead>{t('panel.supplies.summary.columns.requests')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line) => (
                  <TableRow key={line.key}>
                    <TableCell className="font-medium">{line.name}</TableCell>
                    <TableCell>{t(`supplies.units.${line.unit}`)}</TableCell>
                    <TableCell>{line.quantity}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {sourceText(line.sources)}
                    </TableCell>
                    <TableCell>{line.requestCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={lines.length === 0}
            onClick={downloadCsv}
          >
            {t('panel.supplies.summary.csv')}
          </Button>
          <Button type="button" disabled={lines.length === 0} onClick={downloadXlsx}>
            {t('panel.supplies.summary.xlsx')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
