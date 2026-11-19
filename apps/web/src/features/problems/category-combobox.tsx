'use client';

import { problemLevelTone, type ProblemLevel } from '@str-ops/shared';
import {
  categoryLevel,
  categoryName,
  indexCategories,
  inPickOrder,
  matchCategories,
} from '@str-ops/shared/src/problems/categories';
import { cn } from 'cn';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/lib/use-language';

import type { ReportCategory } from './catalog';

/**
 * What was typed as a search. With the list closed the field shows the chosen name with the caret
 * after it, and the letters typed next arrive appended to it: the search is those letters, not
 * «Затоплениед». A name edited in its middle is searched as it reads.
 */
function searchTyped(value: string, shownName: string): string {
  return shownName !== '' && value.startsWith(shownName) ? value.slice(shownName.length) : value;
}

interface CategoryComboboxProps {
  /** The input's id, for the form's `<Label htmlFor>`. */
  id: string;
  categories: readonly ReportCategory[];
  selectedId: string | null;
  onSelect: (category: ReportCategory) => void;
  isDisabled?: boolean;
}

/**
 * What broke, picked from the company's catalogue (hosts.problem_report_mode = catalog) — the
 * phone's choice of a category (`CategoryPicker`), in the panel's form.
 *
 * One field that is its own search: the manager types the first letters of any word of a name,
 * a translation or a synonym, case aside and ё read as е, and the list narrows at once
 * (`matchCategories`). The list is in the phone's order — low on top, critical at the bottom
 * (`inPickOrder`) — the search's answers too. Each row carries its urgency as a chip, the word and
 * the tone, never colour alone; the field shows the chosen one's beside its name. The urgency is
 * shown, never chosen: the server files the task with the category's own.
 *
 * The keyboard: ↓ opens and walks the list, ↑ walks back, Enter takes the row in focus and never
 * sends the form, Escape closes the list and leaves the form open. The list sits under the field
 * inside the form rather than floating over it: nothing of it is cut off by the window's edge.
 */
export function CategoryCombobox({
  id,
  categories,
  selectedId,
  onSelect,
  isDisabled = false,
}: CategoryComboboxProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const listId = useId();
  const levelId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  // In the order the phone offers, the search's answers too: low on top, critical last.
  const index = useMemo(() => indexCategories(inPickOrder(categories)), [categories]);
  const shown = useMemo(() => matchCategories(index, query), [index, query]);

  const selected = categories.find((category) => category.id === selectedId) ?? null;
  const selectedLevel = selected === null ? null : categoryLevel(selected);
  const selectedName = selected === null ? '' : categoryName(selected, language);
  const activeAt = shown.length === 0 ? -1 : Math.min(active, shown.length - 1);
  const activeCategory = activeAt === -1 ? null : shown[activeAt];
  const optionId = (category: ReportCategory) => `${listId}-${category.id}`;
  const hasList = isOpen && shown.length > 0;
  const showsLevel = !isOpen && selectedLevel !== null;

  // The row in focus stays in sight as the arrows walk past the list's edge.
  useEffect(() => {
    if (isOpen && activeCategory !== null) {
      document
        .getElementById(`${listId}-${activeCategory.id}`)
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [isOpen, activeCategory, listId]);

  const open = () => {
    if (isOpen) {
      return;
    }
    // The chosen one in focus, where the list starts whole.
    const at = selected === null ? -1 : shown.indexOf(selected);
    setActive(Math.max(at, 0));
    setIsOpen(true);
  };

  // The search starts empty the next time: what was typed was for this look.
  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const choose = (category: ReportCategory) => {
    onSelect(category);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (isOpen) {
          setActive(Math.min(activeAt + 1, shown.length - 1));
        } else {
          open();
        }
        return;
      case 'ArrowUp':
        if (isOpen) {
          event.preventDefault();
          setActive(Math.max(activeAt - 1, 0));
        }
        return;
      case 'Enter':
        // A press meant for the list never sends the form.
        if (isOpen) {
          event.preventDefault();
          if (activeCategory !== null) {
            choose(activeCategory);
          }
        }
        return;
      case 'Escape':
        // The list closes; the form stays.
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      case 'Tab':
        close();
        return;
      default:
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={hasList ? listId : undefined}
          aria-activedescendant={
            hasList && activeCategory !== null ? optionId(activeCategory) : undefined
          }
          aria-describedby={showsLevel ? levelId : undefined}
          aria-required
          disabled={isDisabled}
          className={cn('h-11', showsLevel ? 'pr-36' : 'pr-9')}
          value={isOpen ? query : selectedName}
          placeholder={
            isOpen ? selectedName || t('problems.searchCategories') : t('problems.pickCategory')
          }
          onClick={open}
          onChange={(event) => {
            setQuery(searchTyped(event.target.value, isOpen ? '' : selectedName));
            setActive(0);
            setIsOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={close}
        />
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-2">
          {!isOpen && selectedLevel !== null ? (
            <LevelChip id={levelId} level={selectedLevel} />
          ) : null}
          <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
        </div>
      </div>

      {isOpen ? (
        <div className="overflow-hidden rounded-lg bg-popover shadow-md ring-1 ring-foreground/10">
          {shown.length === 0 ? (
            <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
              {t('problems.noCategoryMatch')}
            </p>
          ) : (
            <ul
              id={listId}
              role="listbox"
              aria-label={t('problems.categoryLabel')}
              className="max-h-60 overflow-y-auto p-1"
              // A press on a row must not take the focus from the field: its blur would close
              // the list before the press lands.
              onMouseDown={(event) => event.preventDefault()}
            >
              {shown.map((category, at) => (
                <CategoryOption
                  key={category.id}
                  id={optionId(category)}
                  category={category}
                  name={categoryName(category, language)}
                  isSelected={category.id === selectedId}
                  isActive={at === activeAt}
                  onChoose={choose}
                  onPoint={() => setActive(at)}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

interface CategoryOptionProps {
  id: string;
  category: ReportCategory;
  name: string;
  isSelected: boolean;
  isActive: boolean;
  onChoose: (category: ReportCategory) => void;
  onPoint: () => void;
}

function CategoryOption({
  id,
  category,
  name,
  isSelected,
  isActive,
  onChoose,
  onPoint,
}: CategoryOptionProps) {
  const { t } = useTranslation();
  const level = categoryLevel(category);

  return (
    <li
      id={id}
      role="option"
      aria-selected={isSelected}
      aria-label={
        level === null
          ? name
          : t('problems.categoryOption', { name, priority: t(`problems.priorities.${level}`) })
      }
      data-active={isActive || undefined}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        isActive && 'bg-muted',
      )}
      onClick={() => onChoose(category)}
      onMouseMove={onPoint}
    >
      <Check
        aria-hidden
        className={cn('size-4 shrink-0 text-primary', isSelected ? 'opacity-100' : 'opacity-0')}
      />
      <span className="min-w-0 flex-1 break-words">{name}</span>
      {level === null ? null : <LevelChip level={level} />}
    </li>
  );
}

interface LevelChipProps {
  level: ProblemLevel;
  id?: string;
}

/** The urgency a category files a task with: shown, never chosen. */
function LevelChip({ level, id }: LevelChipProps) {
  const { t } = useTranslation();
  return (
    <Badge id={id} tone={problemLevelTone(level)}>
      {t(`problems.priorities.${level}`)}
    </Badge>
  );
}
