import type { SupplyStatus } from './schema';

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

/** New requests read loudest: they wait for the manager. */
export function statusVariant(status: SupplyStatus): BadgeVariant {
  switch (status) {
    case 'new':
      return 'default';
    case 'accepted':
    case 'ordered':
      return 'secondary';
    case 'fulfilled':
    case 'rejected':
      return 'outline';
  }
}
