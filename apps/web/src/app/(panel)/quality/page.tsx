import { QualityView } from '@/features/quality/quality-view';

/**
 * «Качество объектов» (docs/property-intelligence-plan.md §6.2), read only. The
 * data is the client's to fetch; the database refuses everyone but the office.
 */
export default function QualityPage() {
  return <QualityView />;
}
