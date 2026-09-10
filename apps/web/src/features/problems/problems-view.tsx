'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { ProblemsArchive } from './problems-archive';
import { ProblemsBoard } from './problems-board';
import { ProblemsTable } from './problems-table';
import { isProblemArchived, matchesQuery } from './schema';
import { useProblems } from './use-problems';

type View = 'board' | 'list' | 'archive';

/** The section's front page: search, then the board, the list or the archive. */
export function ProblemsView() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('board');
  const { data, isPending, isError } = useProblems();

  const matching = (data ?? []).filter((problem) => matchesQuery(problem, query));
  const problems = matching.filter((problem) => !isProblemArchived(problem));
  const archived = matching.filter(isProblemArchived);
  const emptyText = query.trim() === '' ? t('panel.problems.empty') : t('panel.problems.emptyFiltered');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('panel.problems.title')}</h1>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('panel.problems.searchPlaceholder')}
          aria-label={t('panel.problems.searchPlaceholder')}
          className="w-72"
        />
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.problems.loading')}</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.problems.loadError')}
        </p>
      ) : (
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList>
            <TabsTrigger value="board">{t('panel.problems.viewBoard')}</TabsTrigger>
            <TabsTrigger value="list">{t('panel.problems.viewList')}</TabsTrigger>
            <TabsTrigger value="archive">
              {t('panel.problems.viewArchive')}
              <span className="ml-1 text-xs text-muted-foreground">{archived.length}</span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="board">
            <ProblemsBoard problems={problems} isFiltered={query.trim() !== ''} />
          </TabsContent>
          <TabsContent value="list">
            {problems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{emptyText}</p>
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
