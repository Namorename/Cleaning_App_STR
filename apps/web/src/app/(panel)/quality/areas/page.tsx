import { AreasView } from '@/features/quality/areas-view';

/**
 * «Области», read only. The data is the client's to fetch; the database refuses
 * everyone but the office, and the proxy keeps the head technician out of /quality.
 */
export default function QualityAreasPage() {
  return <AreasView />;
}
