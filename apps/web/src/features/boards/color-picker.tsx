'use client';

import { CARD_COLOR_NAMES, type CardColor } from '@str-ops/shared';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cardColorStyle, SWATCH_CLASS } from '@/components/board/card-color';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  value: CardColor | null;
  onChange: (color: CardColor | null) => void;
  /** The name of the group, said by a screen reader. */
  label: string;
  disabled?: boolean;
}

/**
 * The card palette as a row of swatches and «Без цвета»: one radio group, its
 * colours named (a colour is never told by itself), the chosen one ticked.
 */
export function ColorPicker({ value, onChange, label, disabled = false }: ColorPickerProps) {
  const { t } = useTranslation();
  const options: (CardColor | null)[] = [null, ...CARD_COLOR_NAMES];

  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((color) => {
        const isChosen = color === value;
        const name = color === null ? t('boards.noColor') : t(`boards.colors.${color}`);
        return (
          <button
            key={color ?? 'none'}
            type="button"
            aria-pressed={isChosen}
            aria-label={name}
            title={name}
            disabled={disabled}
            onClick={() => onChange(color)}
            style={cardColorStyle(color)}
            className={cn(
              'flex size-11 items-center justify-center rounded-full ring-1 ring-foreground/20 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
              isChosen && 'ring-2 ring-foreground',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-7 items-center justify-center rounded-full',
                color === null
                  ? 'border border-dashed border-muted-foreground bg-card'
                  : SWATCH_CLASS,
              )}
            >
              {isChosen ? (
                <Check className={cn('size-4', color === null ? 'text-foreground' : 'text-card')} />
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
