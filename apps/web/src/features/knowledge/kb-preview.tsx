'use client';

import { parseKbMarkup, type KbBlock, type KbLine, type Language } from '@str-ops/shared';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

/** The phone's width the preview is drawn at (an iPhone 14–16, 390 pt). */
const PHONE_WIDTH_CLASS = 'max-w-[390px]';

/** The host a link opens, written beside it: the reader sees where she is going. */
function hostOf(href: string): string {
  return href.replace(/^https:\/\//i, '').split(/[/?#]/, 1)[0];
}

function Line({ line }: { line: KbLine }) {
  return (
    <>
      {line.map((piece, index) => {
        if (piece.kind === 'bold') {
          return <strong key={index}>{piece.text}</strong>;
        }
        if (piece.kind === 'link') {
          const host = hostOf(piece.href);
          return (
            <Fragment key={index}>
              <a
                href={piece.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary underline underline-offset-2"
              >
                {piece.text}
              </a>
              {piece.text === piece.href ? null : (
                <span className="text-xs text-muted-foreground"> ({host})</span>
              )}
            </Fragment>
          );
        }
        return <Fragment key={index}>{piece.text}</Fragment>;
      })}
    </>
  );
}

/** Lines of one block, a line break between them as the author typed. */
function Lines({ lines }: { lines: readonly KbLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          <Line line={line} />
        </Fragment>
      ))}
    </>
  );
}

function Block({ block }: { block: KbBlock }) {
  const { t } = useTranslation();

  switch (block.kind) {
    case 'paragraph':
      return (
        <p>
          <Lines lines={block.lines} />
        </p>
      );
    case 'bullets':
      return (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {block.items.map((item, index) => (
            <li key={index}>
              <Line line={item} />
            </li>
          ))}
        </ul>
      );
    case 'numbered':
      return (
        <ol start={block.start} className="flex list-decimal flex-col gap-1 pl-5">
          {block.items.map((item, index) => (
            <li key={index}>
              <Line line={item} />
            </li>
          ))}
        </ol>
      );
    case 'steps':
      return (
        <ol data-slot="kb-steps" className="flex flex-col gap-3">
          {block.items.map((item, index) => {
            const number = block.start + index;
            return (
              <li key={index} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground"
                >
                  {number}
                </span>
                <span className="sr-only">{t('knowledge.step', { number })}</span>
                <span className="pt-1.5">
                  <Line line={item} />
                </span>
              </li>
            );
          })}
        </ol>
      );
    case 'important':
      return (
        <div
          role="note"
          className="rounded-lg border-l-4 border-tone-urgent-border bg-tone-urgent-bg p-3 text-tone-urgent-fg"
        >
          <p className="mb-1 font-semibold">{t('knowledge.important')}</p>
          <p>
            <Lines lines={block.lines} />
          </p>
        </div>
      );
  }
}

/** The blocks of a text as the phone will draw them: elements, never HTML from the text. */
export function KbBlocks({ blocks }: { blocks: readonly KbBlock[] }) {
  return (
    <div className="flex flex-col gap-3 text-base leading-relaxed">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

interface KbPreviewProps {
  title: string;
  body: string;
  /** The language of the text shown, for the reader's voice and hyphenation. */
  language: Language;
}

/**
 * The article as a cleaner will read it on the phone: the same reader of the
 * text (`parseKbMarkup`, packages/shared), at the phone's width.
 */
export function KbPreview({ title, body, language }: KbPreviewProps) {
  const { t } = useTranslation();
  const blocks = parseKbMarkup(body);

  return (
    <section aria-label={t('panel.knowledge.editor.preview')} className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {t('panel.knowledge.editor.preview')}
      </h2>
      <div
        data-slot="kb-phone"
        lang={language}
        className={`mx-auto flex w-full ${PHONE_WIDTH_CLASS} flex-col gap-3 rounded-3xl border-4 border-muted bg-background p-4 break-words`}
      >
        {title.trim() === '' ? null : <h3 className="text-xl font-bold">{title}</h3>}
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('panel.knowledge.editor.previewEmpty')}</p>
        ) : (
          <KbBlocks blocks={blocks} />
        )}
      </div>
    </section>
  );
}
