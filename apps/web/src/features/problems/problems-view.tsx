'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAddressState } from '@/lib/use-address-state';

import { readProblemsAddress, writeProblemsAddress, type ProblemView } from './address';
import { ProblemsArchive } from './problems-archive';
import { ProblemsBoard } from './problems-board';
import { ProblemsTable } from './problems-table';
import { isProblemArchived, matchesQuery } from './schema';
import { useProblems } from './use-problems';

/**
 * The section's front page: search, then the board, the list or the archive.
 *
 * The view is in the address (owner, 05.10): a bare `/problems` is the board,
 * a change of view is a step «Назад» walks back, and a task opened from a view
 * returns to it.
 */
export function ProblemsView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [address, setAddress] = useAddressState(readProblemsAddress, writeProblemsAddress);
  const { view } = address;
  const { data, isPending, isError, error } = useProblems();

  const matching = (data ?? []).filter((problem) => matchesQuery(problem, query));
  const problems = matching.filter((problem) => !isProblemArchived(problem));
  const archived = matching.filter(isProblemArchived);
  const emptyText =
    query.trim() === '' ? t('panel.problems.empty') : t('panel.problems.emptyFiltered');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('panel.problems.title')}
        actions={
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('panel.problems.searchPlaceholder')}
            aria-label={t('panel.problems.searchPlaceholder')}
            className="h-11 w-full sm:w-72"
          />
        }
      />

      {isPending ? (
        <LoadingState>{t('panel.problems.loading')}</LoadingState>
      ) : isError ? (
        <ErrorState message={t('panel.problems.loadError')} error={error} />
      ) : (
        <Tabs
          value={view}
          onValueChange={(value) => setAddress({ view: value as ProblemView }, 'push')}
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
            <ProblemsBoard problems={problems} isFiltered={query.trim() !== ''} />
          </TabsContent>
          <TabsContent value="list">
            {problems.length === 0 ? (
              <EmptyState>{emptyText}</EmptyState>
            ) : (
              <ProblemsTable problems={problems} />
            )}
          </TabsContent>
          <TabsContent value="archive">
            <ProblemsArchive problems={archived} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
