'use client';

import { SUPPORTED_LANGUAGES, isSupportedLanguage, type Language } from '@str-ops/shared';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { MarkupField } from './markup-field';
import {
  hasText,
  KB_TITLE_MAX,
  withLanguage,
  type ArticleDraft,
  type KbTextDraft,
} from './schema';

interface TextEditorProps {
  draft: ArticleDraft;
  onChange: (draft: ArticleDraft) => void;
  /** The language tab open; the preview shows it. */
  tab: Language;
  onTabChange: (language: Language) => void;
}

/** The text of one language: the original's, or a translation's (empty when there is none). */
export function textIn(draft: ArticleDraft, language: Language): KbTextDraft {
  return language === draft.language
    ? { title: draft.title, body: draft.body }
    : (draft.translations[language] ?? { title: '', body: '' });
}

function withText(draft: ArticleDraft, language: Language, text: KbTextDraft): ArticleDraft {
  return language === draft.language
    ? { ...draft, title: text.title, body: text.body }
    : { ...draft, translations: { ...draft.translations, [language]: text } };
}

/**
 * The article's words: the language the author writes in (required), and a
 * tab for it and for each other language — those are translations, each
 * optional (the owner's decision 4 of 2026-10-17).
 */
export function TextEditor({ draft, onChange, tab, onTabChange }: TextEditorProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const languages = [
    draft.language,
    ...SUPPORTED_LANGUAGES.filter((language) => language !== draft.language),
  ];
  const nameOf = (language: Language) => t(`panel.knowledge.languages.${language}`);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${baseId}-language`} className="text-sm font-medium">
          {t('panel.knowledge.editor.language')}
        </label>
        <NativeSelect
          id={`${baseId}-language`}
          value={draft.language}
          className="sm:w-64"
          onChange={(event) => {
            const language = event.target.value;
            if (isSupportedLanguage(language)) {
              onChange(withLanguage(draft, language));
              onTabChange(language);
            }
          }}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {nameOf(language)}
            </option>
          ))}
        </NativeSelect>
        <p className="text-xs text-muted-foreground">{t('panel.knowledge.editor.languageHint')}</p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (typeof value === 'string' && isSupportedLanguage(value)) {
            onTabChange(value);
          }
        }}
      >
        <TabsList aria-label={t('panel.knowledge.editor.languageTabs')}>
          {languages.map((language) => {
            const isOriginal = language === draft.language;
            const isEmpty = !isOriginal && !hasText(draft.translations[language]);
            return (
              <TabsTrigger key={language} value={language} className="px-3">
                {nameOf(language)}
                <span className="text-xs font-normal text-muted-foreground">
                  {isOriginal
                    ? `· ${t('panel.knowledge.originalMark')}`
                    : isEmpty
                      ? `· ${t('panel.knowledge.editor.noTranslation')}`
                      : null}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {languages.map((language) => {
          const text = textIn(draft, language);
          const isOriginal = language === draft.language;
          const titleId = `${baseId}-${language}-title`;
          return (
            <TabsContent key={language} value={language} className="flex flex-col gap-3 pt-2">
              {isOriginal ? null : (
                <p className="text-xs text-muted-foreground">
                  {t('panel.knowledge.editor.translationHint')}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor={titleId} className="text-sm font-medium">
                  {t('panel.knowledge.editor.title')}
                </label>
                <Input
                  id={titleId}
                  lang={language}
                  value={text.title}
                  maxLength={KB_TITLE_MAX}
                  required={isOriginal}
                  onChange={(event) =>
                    onChange(withText(draft, language, { ...text, title: event.target.value }))
                  }
                />
              </div>
              <MarkupField
                id={`${baseId}-${language}-body`}
                label={t('panel.knowledge.editor.body')}
                lang={language}
                value={text.body}
                onChange={(body) => onChange(withText(draft, language, { ...text, body }))}
              />
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
