'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { todayIso } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useAddressState } from '@/lib/use-address-state';

import { readTasksAddress, writeTasksAddress } from './address';
import { CancelTaskDialog } from './cancel-task-dialog';
import {
  groupTasks,
  hasFilters,
  matchesFilters,
  TASK_TABS,
  tabOf,
  type Task,
  type TaskFilters,
  type TaskTab,
} from './schema';
import { TaskDrawer } from './task-drawer';
import { TaskForm } from './task-form';
import { TasksFilters } from './tasks-filters';
import { TasksTable } from './tasks-table';
import { useCancelTask, useStaff, useTasks } from './use-tasks';

/**
 * The section's page (5.4, variant A): the filters, three tabs, and the work
 * as a dense table under headings — a part of the day on «Сегодня», because
 * that is how a day is worked; the day itself on the tabs that span days.
 *
 * The tab and the filters live in the address: leaving the screen and coming
 * back with «Назад», a reload or a forwarded link find it as it was. Each new
 * tab is a step of the history, so «Назад» also walks back through the tabs.
 */
export function TasksView() {
  const { t } = useTranslation();
  const { data, isPending, isError, error } = useTasks();
  const unread = useUnreadSubjects();
  const staff = useStaff();
  // The cancel lives here, not in the row: its refusal arrives after the
  // list has refreshed, and the row that asked may have left the tab.
  const cancel = useCancelTask();
  const cancelFailure = cancel.isError ? serverErrorText(cancel.error) : null;
  const [address, setAddress] = useAddressState(readTasksAddress, writeTasksAddress);
  const { tab, filters } = address;
  // A tab is a step «Назад» walks back; a filter is changed in place (owner, 04.10).
  const setTab = (next: TaskTab) => setAddress({ ...address, tab: next }, 'push');
  const setFilters = (next: TaskFilters) => setAddress({ ...address, filters: next });
  // The dialogs and the drawer live only while they are open: a fresh mount
  // is a fresh draft, which is why none needs an effect to reset itself.
  const [editing, setEditing] = useState<{ task: Task | null } | null>(null);
  const [reading, setReading] = useState<Task | null>(null);
  const [confirming, setConfirming] = useState<Task | null>(null);

  // One instant for the whole render, so every row agrees on what a tail is.
  const now = new Date();
  const today = todayIso(now);
  const tasks = (data ?? []).filter((task) => matchesFilters(task, filters));
  const inTab = (key: TaskTab) => tasks.filter((task) => tabOf(task, today) === key);
  const groups = groupTasks(inTab(tab), tab, now);

  const callOff = (task: Task) => {
    cancel.mutate(task.id);
    setConfirming(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <PageHeader
        title={t('panel.tasks.title')}
        actions={
          <Button type="button" className="h-11 px-4" onClick={() => setEditing({ task: null })}>
            <Plus aria-hidden="true" />
            {t('panel.tasks.actions.new')}
          </Button>
        }
      />

      <TasksFilters filters={filters} onChange={setFilters} staff={staff.data ?? []} />

      {cancelFailure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {cancelFailure.text}
          {cancelFailure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{cancelFailure.detail}</span>
          )}
        </p>
      )}

      {isPending ? (
        <LoadingState>{t('panel.tasks.loading')}</LoadingState>
      ) : isError ? (
        <ErrorState message={t('panel.tasks.loadError')} error={error} />
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as TaskTab)}>
          <TabsList className="h-auto">
            {TASK_TABS.map((key) => (
              <TabsTrigger key={key} value={key} className="min-h-11 px-3">
                {t(`panel.tasks.tabs.${key}`)}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {inTab(key).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab}>
            {groups.length === 0 ? (
              <EmptyState>
                {hasFilters(filters) ? t('panel.tasks.emptyFiltered') : t('panel.tasks.empty')}
              </EmptyState>
            ) : (
              <TasksTable
                groups={groups}
                now={now}
                unread={unread.tasks}
                onEdit={(task) => setEditing({ task })}
                onOpenWork={setReading}
                onCancel={setConfirming}
              />
            )}
          </TabsContent>
        </Tabs>
      )}

      {editing === null ? null : <TaskForm task={editing.task} onClose={() => setEditing(null)} />}
      {reading === null ? null : <TaskDrawer task={reading} onClose={() => setReading(null)} />}
      {confirming === null ? null : (
        <CancelTaskDialog
          task={confirming}
          onConfirm={callOff}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
