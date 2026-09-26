import { CalendarView } from '@/features/calendar/calendar-view';

/**
 * Stage 7: the calendar. The data is the client's to fetch.
 *
 * `CALENDAR_FIXTURE=1` — a server variable, never `NEXT_PUBLIC_*`, and not set
 * on Vercel — turns a local build into the stand: the fixture instead of the
 * database (docs/f10-plan.md, §5). `CALENDAR_FIXTURE=3` is the stand with the
 * fixture three times over, for the measurement at ×3 (7.6).
 */
export default function CalendarPage() {
  const fixture = process.env.CALENDAR_FIXTURE;
  return (
    <CalendarView fixture={fixture === '1' || fixture === '3'} scale={fixture === '3' ? 3 : 1} />
  );
}
