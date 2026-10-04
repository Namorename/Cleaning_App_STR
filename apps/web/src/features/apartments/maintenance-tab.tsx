'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { StatusBadge, statusKey } from '@/components/status-badge';
import { EmptyState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

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
  const language = useLanguage();
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
        <h3 className="text-sm font-medium">{t('panel.apartments.maintenance.state')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={`property.${property.status}`}>
            {t(`panel.apartments.tabs.${property.status}`)}
          </StatusBadge>
          {moves.map((status) => (
            <Button
              key={status}
              type="button"
              variant={status === 'archived' ? 'destructive' : 'outline'}
              className="h-11"
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
        <h3 className="text-sm font-medium">{t('panel.apartments.maintenance.jobs')}</h3>
        {tasks.isPending ? (
          <LoadingState>{t('panel.apartments.loading')}</LoadingState>
        ) : jobs.length === 0 ? (
          <EmptyState>{t('panel.apartments.maintenance.noJobs')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <span className="flex-1 text-sm">
                  {job.title ?? t('panel.apartments.maintenance.untitled')}
                  {/* The card's heading is the house; this says which door
                      inside it, for a job the fold brought in from a room. */}
                  {job.unit_name === null ? null : (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('panel.apartments.maintenance.inUnit', { name: job.unit_name })}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {job.scheduled_date === null ? '—' : formatDay(job.scheduled_date, language)}
                </span>
                {job.assignee_name === null ? null : (
                  <Person name={job.assignee_name} role="tech" className="text-xs" />
                )}
                <StatusBadge status={statusKey('tasks', job.status)}>
                  {t(`panel.tasks.statuses.${job.status}`)}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          {t('panel.apartments.maintenance.reports', { open: openReports.length })}
        </h3>
        {problems.isPending ? (
          <LoadingState>{t('panel.apartments.loading')}</LoadingState>
        ) : reports.length === 0 ? (
          <EmptyState>{t('panel.apartments.maintenance.noReports')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.map((report) => (
              <li
                key={report.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-2"
              >
                <span className="flex-1 text-sm">
                  <Link className="underline" href={`/problems/${report.id}`}>
                    {report.title}
                  </Link>
                  {report.unit_name === null ? null : (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('panel.apartments.maintenance.inUnit', { name: report.unit_name })}
                    </span>
                  )}
                </span>
                {/* Shared with the phone: one wording for a report's state. */}
                <StatusBadge status={statusKey('problems', report.status)}>
                  {t(`problems.statuses.${report.status}`)}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {subject === null ? null : <StatusDialog subject={subject} onClose={() => setSubject(null)} />}
    </div>
  );
}
