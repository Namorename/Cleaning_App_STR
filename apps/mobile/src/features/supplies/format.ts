import { i18n } from '@/i18n';

import type { SupplyItem, SupplyPriority, SupplyRequest, SupplyStatus, SupplyUnit } from './schema';

const SUMMARY_ITEMS = 3;

export function supplyStatusText(status: SupplyStatus): string {
  return i18n.t(`supplies.statuses.${status}`);
}

export function supplyPriorityText(priority: SupplyPriority): string {
  return i18n.t(`supplies.priorities.${priority}`);
}

export function supplyUnitText(unit: SupplyUnit): string {
  return i18n.t(`supplies.units.${unit}`);
}

/** "2 шт" — the quantity with its unit, no trailing zeros. */
export function formatQuantity(item: SupplyItem): string {
  const amount = Number.isInteger(item.quantity) ? String(item.quantity) : item.quantity.toFixed(2);
  return `${amount} ${supplyUnitText(item.unit)}`;
}

/** The first few lines with quantities, and how many more there are. */
export function itemsSummary(items: readonly SupplyItem[]): string {
  const sorted = items.slice().sort((a, b) => a.sort_order - b.sort_order);
  const shown = sorted
    .slice(0, SUMMARY_ITEMS)
    .map((item) => `${item.name} × ${formatQuantity(item)}`)
    .join(', ');
  const rest = sorted.length - SUMMARY_ITEMS;

  return rest > 0 ? i18n.t('supplies.moreItems', { shown, count: rest }) : shown;
}

/** The listing's name, or the word for a request that has none. */
export function supplyPlace(request: SupplyRequest): string {
  return request.property?.name ?? i18n.t('supplies.general');
}
