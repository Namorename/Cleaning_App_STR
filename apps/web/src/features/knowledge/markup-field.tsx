'use client';

import {
  Bold,
  Link2,
  List,
  ListOrdered,
  MessageSquareWarning,
  Footprints,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { applyMark, type Edited, type MarkKind } from './markup-edit';
import { KB_BODY_MAX } from './schema';

interface ToolButton {
  mark: MarkKind;
  /** panel.knowledge.editor.toolbar.<label> */
  label: string;
  icon: LucideIcon;
}

const TOOLS: readonly ToolButton[] = [
  { mark: 'bold', label: 'bold', icon: Bold },
  { mark: 'bullet', label: 'bullets', icon: List },
  { mark: 'numbered', label: 'numbered', icon: ListOrdered },
  { mark: 'step', label: 'steps', icon: Footprints },
  { mark: 'link', label: 'link', icon: Link2 },
  { mark: 'important', label: 'important', icon: MessageSquareWarning },
];

interface MarkupFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The language of the text typed, for the browser's spelling and a reader's voice. */
  lang: string;
}

/**
 * The text of an article with the buttons that put the marks in — the same
 * marks `parseKbMarkup` reads — so nobody has to remember them. The marks stay
 * visible in the field; the preview beside it shows what they make.
 */
export function MarkupField({ id, label, value, onChange, lang }: MarkupFieldProps) {
  const { t } = useTranslation();
  const field = useRef<HTMLTextAreaElement>(null);
  // Where the selection goes once the edited text is on screen.
  const pending = useRef<Edited | null>(null);

  useLayoutEffect(() => {
    const element = field.current;
    const next = pending.current;
    if (next === null || element === null || element.value !== next.text) {
      return;
    }
    pending.current = null;
    element.focus();
    element.setSelectionRange(next.start, next.end);
  }, [value]);

  const apply = (mark: MarkKind) => {
    const element = field.current;
    const start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    const edited = applyMark(value, start, end, mark, t('panel.knowledge.editor.toolbar.linkText'));
    if (edited.text.length > KB_BODY_MAX) {
      return;
    }
    pending.current = edited;
    onChange(edited.text);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div
        role="toolbar"
        aria-label={t('panel.knowledge.editor.toolbar.label')}
        aria-controls={id}
        className="flex flex-wrap gap-1"
      >
        {TOOLS.map(({ mark, label: name, icon: Icon }) => (
          <Button
            key={mark}
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => apply(mark)}
          >
            <Icon aria-hidden="true" />
            {t(`panel.knowledge.editor.toolbar.${name}`)}
          </Button>
        ))}
      </div>
      <Textarea
        ref={field}
        id={id}
        lang={lang}
        value={value}
        maxLength={KB_BODY_MAX}
        rows={14}
        className="min-h-64 font-mono text-sm"
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{t('panel.knowledge.editor.formatHelp')}</span>
        <span className="shrink-0 tabular-nums">
          {value.length} / {KB_BODY_MAX}
        </span>
      </p>
    </div>
  );
}
