import { CalendarView } from '@/features/calendar/calendar-view';

/**
 * Stage 7: the calendar. The data is the client's to fetch.
 *
 * `CALENDAR_FIXTURE=1` — a server variable, never `NEXT_PUBLIC_*`, and not set
 * on Vercel — turns a local build into the stand: the fixture instead of the
 * database (docs/f10-plan.md, §5).
 */
export default function CalendarPage() {
  return <CalendarView fixture={process.env.CALENDAR_FIXTURE === '1'} />;
}
