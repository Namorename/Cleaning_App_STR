'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAddressState } from '@/lib/use-address-state';

import { readProblemsAddress, writeProblemsAddress, type ProblemView } from './address';
import {
  assigneeOptions,
  hasProblemFilters,
  knownFilters,
  matchesProblemFilters,
  placeOptions,
  type ProblemFilters,
} from './filters';
import { NewProblemDialog } from './new-problem-dialog';
import { ProblemsArchive } from './problems-archive';
import { ProblemsBoard } from './problems-board';
import { ProblemsFilters } from './problems-filters';
import { ProblemsTable } from './problems-table';
import { isProblemArchived, type Problem } from './schema';
import { useProblems } from './use-problems';

const NO_PROBLEMS: Problem[] = [];

/**
 * The section's front page: search and filters, then the board, the list or
 * the archive.
 *
 * The view, the search and the filters are in the address (owner, 05.10 and
 * 10.10): a bare `/problems` is the board with nothing filtered, a change of
 * view is a step «Назад» walks back, a filter is changed in place (as in
 * «Уборки», owner, 04.10), and a task opened from a view returns to it as it
 * was. A place or a person no task names any more is set aside rather than
 * left to empty the screen for a reason the bar cannot show.
 *
 * «Новое задание» stands in the header on every view (the owner, 09.10: the
 * panel had no way to create a task); the form lives only while it is open.
 */
export function ProblemsView() {
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [address, setAddress] = useAddressState(readProblemsAddress, writeProblemsAddress);
  const { view } = address;
  const { data, isPending, isError, error } = useProblems();
  const all = data ?? NO_PROBLEMS;

  const places = useMemo(() => placeOptions(all), [all]);
  const people = useMemo(
    () => assigneeOptions(all, address.filters.assigneeId),
    [all, address.filters.assigneeId],
  );
  // Until the tasks are read nothing is known to be gone: a search typed
  // meanwhile must not write the link's place or person out of the address.
  const filters =
    data === undefined ? address.filters : knownFilters(address.filters, places, people);
  const setFilters = (next: ProblemFilters) => setAddress({ view, filters: next });
  const isFiltered = hasProblemFilters(filters);

  const matching = all.filter((problem) => matchesProblemFilters(problem, filters));
  const problems = matching.filter((problem) => !isProblemArchived(problem));
  const archived = matching.filter(isProblemArchived);
  const emptyText = isFiltered ? t('panel.problems.emptyFiltered') : t('panel.problems.empty');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('panel.problems.title')}
        actions={
          <>
            <Input
              type="search"
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
              placeholder={t('panel.problems.searchPlaceholder')}
              aria-label={t('panel.problems.searchPlaceholder')}
              className="h-11 w-full sm:w-72"
            />
            <Button type="button" className="h-11 px-4" onClick={() => setIsCreating(true)}>
              <Plus aria-hidden="true" />
              {t('panel.problems.form.new')}
            </Button>
          </>
        }
      />

      {isPending ? (
        <LoadingState>{t('panel.problems.loading')}</LoadingState>
      ) : isError ? (
        <ErrorState message={t('panel.problems.loadError')} error={error} />
      ) : (
        <>
          <ProblemsFilters
            filters={filters}
            onChange={setFilters}
            places={places}
            people={people}
          />
          <Tabs
            value={view}
            onValueChange={(value) => setAddress({ view: value as ProblemView, filters }, 'push')}
          >
            <TabsList className="h-auto">
              <TabsTrigger value="board" className="min-h-11 px-3">
                {t('panel.problems.viewBoard')}
              </TabsTrigger>
              <TabsTrigger value="list" className="min-h-11 px-3">
                {t('panel.problems.viewList')}
              </TabsTrigger>
              <TabsTrigger value="archive" className="min-h-11 px-3">
                {t('panel.problems.viewArchive')}
                <span className="ml-1 text-xs text-muted-foreground">{archived.length}</span>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="board">
              <ProblemsBoard problems={problems} isFiltered={isFiltered} filters={filters} />
            </TabsContent>
            <TabsContent value="list">
              {problems.length === 0 ? (
                <EmptyState>{emptyText}</EmptyState>
              ) : (
                <ProblemsTable problems={problems} filters={filters} />
              )}
            </TabsContent>
            <TabsContent value="archive">
              <ProblemsArchive problems={archived} isFiltered={isFiltered} filters={filters} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {isCreating ? (
        <NewProblemDialog from={{ view, filters }} onClose={() => setIsCreating(false)} />
      ) : null}
    </div>
  );
}
