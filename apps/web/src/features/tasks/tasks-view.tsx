'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDay, todayIso } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { TaskCard } from './task-card';
import { TaskDrawer } from './task-drawer';
import { TaskForm } from './task-form';
import {
  EMPTY_FILTERS,
  groupTasks,
  matchesFilters,
  TASK_TABS,
  TASK_TYPES,
  tabOf,
  type Task,
  type TaskFilters,
  type TaskTab,
} from './schema';
import { useStaff, useTasks } from './use-tasks';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

/**
 * The section's page: three tabs, a filter bar, and the work under headings.
 *
 * Today is grouped by the part of the day, because that is how a day is
 * worked; the other tabs span days and are grouped by the day itself.
 */
export function TasksView() {
  const { t } = useTranslation();
  const language = useLanguage();
  const { data, isPending, isError } = useTasks();
  const staff = useStaff();
  const [tab, setTab] = useState<TaskTab>('today');
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_FILTERS);
  // The dialog and the drawer live only while they are open: a fresh mount is
  // a fresh draft, which is why neither needs an effect to reset itself.
  const [editing, setEditing] = useState<{ task: Task | null } | null>(null);
  const [reading, setReading] = useState<Task | null>(null);

  const today = todayIso();
  const tasks = (data ?? []).filter((task) => matchesFilters(task, filters));
  const inTab = (key: TaskTab) => tasks.filter((task) => tabOf(task, today) === key);
  const groups = groupTasks(inTab(tab), tab);
  const isFiltered =
    filters.query.trim() !== '' || filters.assigneeId !== 'all' || filters.type !== 'all';

  const openNew = () => setEditing({ task: null });
  const openEdit = (task: Task) => setEditing({ task });
  const openWork = (task: Task) => setReading(task);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('panel.tasks.title')}</h1>
        <Button type="button" onClick={openNew}>
          {t('panel.tasks.actions.new')}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          placeholder={t('panel.tasks.filters.search')}
          aria-label={t('panel.tasks.filters.search')}
          className="w-72"
        />
        <select
          className={SELECT_CLASS}
          aria-label={t('panel.tasks.filters.assignee')}
          value={filters.assigneeId}
          onChange={(event) => setFilters({ ...filters, assigneeId: event.target.value })}
        >
          <option value="all">{t('panel.tasks.filters.anyAssignee')}</option>
          <option value="nobody">{t('panel.tasks.filters.nobody')}</option>
          {(staff.data ?? []).map((person) => (
            <option key={person.id} value={person.id}>
              {person.full_name ?? person.id}
            </option>
          ))}
        </select>
        <select
          className={SELECT_CLASS}
          aria-label={t('panel.tasks.filters.type')}
          value={filters.type}
          onChange={(event) =>
            setFilters({ ...filters, type: event.target.value as TaskFilters['type'] })
          }
        >
          <option value="all">{t('panel.tasks.filters.anyType')}</option>
          {TASK_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`panel.tasks.types.${type}`)}
            </option>
          ))}
        </select>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.tasks.loading')}</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.tasks.loadError')}
        </p>
      ) : (
        <Tabs value={tab} onValueChange={(value) => setTab(value as TaskTab)}>
          <TabsList>
            {TASK_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(`panel.tasks.tabs.${key}`)}
                <span className="ml-1 text-xs text-muted-foreground">{inTab(key).length}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab} className="flex flex-col gap-4">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {isFiltered ? t('panel.tasks.emptyFiltered') : t('panel.tasks.empty')}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    {group.kind === 'time'
                      ? t(`panel.tasks.groups.${group.key}`)
                      : formatDay(group.key, language)}
                  </h2>
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      today={today}
                      onEdit={openEdit}
                      onOpenWork={openWork}
                    />
                  ))}
                </section>
              ))
            )}
          </TabsContent>
        </Tabs>
      )}

      {editing === null ? null : (
        <TaskForm task={editing.task} onClose={() => setEditing(null)} />
      )}
      {reading === null ? null : (
        <TaskDrawer task={reading} onClose={() => setReading(null)} />
      )}
    </div>
  );
}
