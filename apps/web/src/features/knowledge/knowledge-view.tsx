'use client';

import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { useAddressState } from '@/lib/use-address-state';

import {
  NEW_ARTICLE,
  readKnowledgeAddress,
  writeKnowledgeAddress,
  type KnowledgeAddress,
} from './address';
import { ArticleEditor } from './article-editor';
import { ArticleFilters, ArticleList, filterArticles } from './article-list';
import { placeIndex } from './places';
import { useArticles, usePlaces } from './use-knowledge';

/**
 * «База знаний», step 1 (docs/knowledge-base-step1.md): the company's
 * articles — text only — for the managers and the head technician to write,
 * translate, place and publish; the phone reads them from step 2.
 *
 * The list or the article open, one at a time: the editor needs the width for
 * the text and the preview beside it. The status, the place and the article
 * open live in the address; opening an article and leaving it are steps «Назад»
 * walks back (the owner's rule of 04.10).
 */
export function KnowledgeView() {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readKnowledgeAddress, writeKnowledgeAddress);
  const articles = useArticles();
  const places = usePlaces();
  const index = placeIndex(places.data ?? []);

  const step = (patch: Partial<KnowledgeAddress>) => setAddress({ ...address, ...patch }, 'push');
  const narrow = (patch: Partial<KnowledgeAddress>) => setAddress({ ...address, ...patch });
  const hrefOf = (article: string) =>
    `/knowledge?${writeKnowledgeAddress({ ...address, article })}`;

  if (address.article !== null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t('panel.nav.knowledge')} />
        <ArticleEditor
          // A new article and an open one are different forms.
          key={address.article}
          articleId={address.article === NEW_ARTICLE ? null : address.article}
          onClose={() => step({ article: null })}
          // The new article's address becomes its own, in place: «Назад» still leads to the list.
          onCreated={(id) => setAddress({ ...address, article: id })}
        />
      </div>
    );
  }

  const rows = filterArticles(articles.data ?? [], address.status, address.place, index);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('panel.nav.knowledge')}
        actions={
          <Button type="button" className="h-11" onClick={() => step({ article: NEW_ARTICLE })}>
            <Plus aria-hidden="true" />
            {t('panel.knowledge.new')}
          </Button>
        }
      />
      <ArticleFilters
        status={address.status}
        place={address.place}
        places={places.data ?? []}
        index={index}
        onStatusChange={(status) => narrow({ status })}
        onPlaceChange={(place) => narrow({ place })}
      />
      {articles.isPending ? (
        <LoadingState>{t('panel.knowledge.loading')}</LoadingState>
      ) : articles.isError ? (
        <ErrorState message={t('panel.knowledge.loadError')} error={articles.error} />
      ) : (
        <ArticleList
          rows={rows}
          hasAny={articles.data.length > 0}
          index={index}
          hrefOf={hrefOf}
          onOpen={(id) => step({ article: id })}
        />
      )}
    </div>
  );
}
