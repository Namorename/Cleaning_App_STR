import { CalendarView } from '@/features/calendar/calendar-view';
import { assigneeFromAddress } from '@/features/calendar/chips';

interface CalendarPageProps {
  searchParams: Promise<{ assignee?: string | string[] }>;
}

/**
 * Stage 7: the calendar. The data is the client's to fetch.
 *
 * `CALENDAR_FIXTURE=1` — a server variable, never `NEXT_PUBLIC_*`, and not set
 * on Vercel — turns a local build into the stand: the fixture instead of the
 * database (docs/f10-plan.md, §5). `CALENDAR_FIXTURE=3` is the stand with the
 * fixture three times over, for the measurement at ×3 (7.6).
 *
 * `?assignee=nobody` opens it on the chips nobody holds: the dashboard's
 * «Без исполнителя» leads here. Read on the server, so a client-side
 * navigation hands the filter over with the page; the key makes a new address
 * a new calendar rather than one that keeps the filter it had.
 */
export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const fixture = process.env.CALENDAR_FIXTURE;
  const assignee = assigneeFromAddress((await searchParams).assignee);
  return (
    <CalendarView
      key={assignee}
      fixture={fixture === '1' || fixture === '3'}
      scale={fixture === '3' ? 3 : 1}
      initialAssignee={assignee}
    />
  );
}
