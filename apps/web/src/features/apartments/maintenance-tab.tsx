'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { PROPERTY_STATUSES, type PropertyDetail, type PropertyStatus } from './schema';
import { StatusDialog, type StatusSubject } from './status-dialog';
import { useMaintenance, usePropertyProblems } from './use-apartments';

interface MaintenanceTabProps {
  property: PropertyDetail;
}

/**
 * The state of the flat, and the work that state is about.
 *
 * "Maintenance" is a state a listing is in, not a log: it says the flat is not
 * taking guests while something is being fixed. So the tab does two things —
 * it is where the state is changed, and it shows what there is to fix, which
 * is the evidence for changing it.
 *
 * Both lists are read-only here. A technician's job is booked from Tasks and a
 * report is handled from Problems; repeating either would be a second place to
 * keep in step with the first.
 */
export function MaintenanceTab({ property }: MaintenanceTabProps) {
  const { t } = useTranslation();
  const tasks = useMaintenance(property.id);
  const problems = usePropertyProblems(property.id);
  const [subject, setSubject] = useState<StatusSubject | null>(null);

  const moves = PROPERTY_STATUSES.filter((status) => status !== property.status);

  const ask = (status: PropertyStatus) => {
    setSubject({ ids: [property.id], status, names: [property.name], openCleanings: 0 });
  };

  const jobs = tasks.data ?? [];
  const reports = problems.data ?? [];
  const openReports = reports.filter((report) => report.resolved_at === null);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t('panel.apartments.maintenance.state')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`panel.apartments.tabs.${property.status}`)}</Badge>
          {moves.map((status) => (
            <Button
              key={status}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => ask(status)}
            >
              {t(`panel.apartments.move.${status}`)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('panel.apartments.maintenance.stateHint')}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t('panel.apartments.maintenance.jobs')}</h2>
        {tasks.isPending ? (
          <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('panel.apartments.maintenance.noJobs')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <span className="flex-1 text-sm">
                  {job.title ?? t('panel.apartments.maintenance.untitled')}
                </span>
                <span className="text-xs text-muted-foreground">{job.scheduled_date ?? '—'}</span>
                {job.assignee === null ? null : (
                  <Person name={job.assignee.full_name} role="tech" className="text-xs" />
                )}
                <Badge variant="outline">{t(`panel.tasks.statuses.${job.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">
          {t('panel.apartments.maintenance.reports', { open: openReports.length })}
        </h2>
        {problems.isPending ? (
          <p className="text-sm text-muted-foreground">{t('panel.apartments.loading')}</p>
        ) : reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('panel.apartments.maintenance.noReports')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((report) => (
              <li
                key={report.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2"
              >
                <Link className="flex-1 text-sm underline" href={`/problems/${report.id}`}>
                  {report.title}
                </Link>
                {/* Shared with the phone: one wording for a report's state. */}
                <Badge variant="outline">{t(`problems.statuses.${report.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {subject === null ? null : <StatusDialog subject={subject} onClose={() => setSubject(null)} />}
    </div>
  );
}
