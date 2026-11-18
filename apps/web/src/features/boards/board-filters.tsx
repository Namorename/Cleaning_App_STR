'use client';

import {
  CARD_COLOR_NAMES,
  CARD_ORDERS,
  DUE_FILTERS,
  EMPTY_CARD_FILTERS,
  hasCardFilters,
  type CardFilters,
  type CardOrder,
  type ColorFilter,
  type DueFilter,
} from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { MultiSelectFilter } from '@/components/multi-select-filter';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';

interface BoardFiltersProps {
  filters: CardFilters;
  onChange: (next: CardFilters) => void;
  order: CardOrder;
  onOrderChange: (next: CardOrder) => void;
}

const DUE_LABEL: Record<DueFilter, string> = {
  all: 'boards.filters.dueAll',
  overdue: 'boards.filters.overdue',
  today: 'boards.filters.today',
  week: 'boards.filters.week',
  none: 'boards.filters.none',
};

/**
 * The board's filters: colour, due date, «Есть неотмеченные шаги», and the
 * order of the columns. The search is in the header. Narrowed, the bar offers
 * «Сбросить».
 */
export function BoardFilters({ filters, onChange, order, onOrderChange }: BoardFiltersProps) {
  const { t } = useTranslation();
  const colorOptions = [
    { id: 'none', label: t('boards.noColor') },
    ...CARD_COLOR_NAMES.map((color) => ({ id: color, label: t(`boards.colors.${color}`) })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelectFilter
        label={t('boards.filters.color')}
        options={colorOptions}
        isFixedSet
        selected={filters.colors}
        onChange={(next) => onChange({ ...filters, colors: next as ColorFilter[] })}
      />
      <NativeSelect
        aria-label={t('boards.filters.due')}
        value={filters.due}
        className="h-11"
        onChange={(event) => onChange({ ...filters, due: event.target.value as DueFilter })}
      >
        {DUE_FILTERS.map((due) => (
          <option key={due} value={due}>
            {t(DUE_LABEL[due])}
          </option>
        ))}
      </NativeSelect>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm ring-1 ring-foreground/15 hover:bg-muted/60">
        <input
          type="checkbox"
          className="size-4"
          checked={filters.openSteps}
          onChange={() => onChange({ ...filters, openSteps: !filters.openSteps })}
        />
        {t('boards.filters.openSteps')}
      </label>
      <NativeSelect
        aria-label={t('boards.order.label')}
        value={order}
        className="h-11"
        onChange={(event) => onOrderChange(event.target.value as CardOrder)}
      >
        {CARD_ORDERS.map((option) => (
          <option key={option} value={option}>
            {t(`boards.order.${option}`)}
          </option>
        ))}
      </NativeSelect>
      {hasCardFilters(filters) ? (
        <Button
          type="button"
          variant="ghost"
          className="h-11"
          onClick={() => onChange({ ...EMPTY_CARD_FILTERS, query: filters.query })}
        >
          {t('boards.filters.reset')}
        </Button>
      ) : null}
    </div>
  );
}
