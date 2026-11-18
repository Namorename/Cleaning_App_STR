'use client';

import { BOARD_LIMITS } from '@str-ops/shared';
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import { StepProgress } from './due-chip';
import { orderedSteps, type CardDetail, type CardStep } from './schema';
import { useDeleteStep, useOrderSteps, useSaveStep, useSetStepDone } from './use-boards';

interface CardStepsProps {
  card: CardDetail;
  /** The owner or an admin, on a card that is not shelved. */
  canEdit: boolean;
}

/**
 * A card's one checklist: tick, change the words, delete, move up and down,
 * add at the end (the words, Enter). A tick shows at once; the journal gets
 * «Шаг отмечен» with the count, never the step's words.
 */
export function CardSteps({ card, canEdit }: CardStepsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const steps = orderedSteps(card.steps);
  const tick = useSetStepDone(card.id);
  const save = useSaveStep();
  const remove = useDeleteStep();
  const order = useOrderSteps();
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [newBody, setNewBody] = useState('');
  const [newId, setNewId] = useState(() => crypto.randomUUID());

  const failed = [tick, save, remove, order].find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = newBody.trim();
    if (body === '' || save.isPending) {
      return;
    }
    save.mutate(
      { stepId: newId, cardId: card.id, body },
      {
        onSuccess: () => {
          setNewBody('');
          setNewId(crypto.randomUUID());
        },
      },
    );
  };

  const saveEdit = () => {
    if (editing === null) {
      return;
    }
    const body = editing.body.trim();
    const step = steps.find((candidate) => candidate.id === editing.id);
    if (body === '' || step === undefined || body === step.body) {
      setEditing(null);
      return;
    }
    save.mutate({ stepId: editing.id, cardId: null, body }, { onSuccess: () => setEditing(null) });
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = steps.map((step) => step.id);
    const other = index + delta;
    if (other < 0 || other >= ids.length) {
      return;
    }
    [ids[index], ids[other]] = [ids[other], ids[index]];
    order.mutate({ cardId: card.id, stepIds: ids });
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {t('boards.steps')}
      </h3>
      <StepProgress steps={steps} />
      {steps.length === 0 ? null : (
        <ul className="flex flex-col">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              canEdit={canEdit}
              editing={editing?.id === step.id ? editing.body : null}
              onTick={() => tick.mutate({ stepId: step.id, done: step.done_at === null })}
              onEdit={() => setEditing({ id: step.id, body: step.body })}
              onEditChange={(body) => setEditing({ id: step.id, body })}
              onEditSave={saveEdit}
              onEditCancel={() => setEditing(null)}
              onDelete={() => remove.mutate(step.id)}
              onUp={() => move(index, -1)}
              onDown={() => move(index, 1)}
            />
          ))}
        </ul>
      )}
      {canEdit ? (
        <form onSubmit={add}>
          <Input
            value={newBody}
            maxLength={BOARD_LIMITS.step}
            placeholder={t('boards.newStep')}
            aria-label={t('boards.addStep')}
            disabled={save.isPending}
            onChange={(event) => setNewBody(event.target.value)}
            className="h-11"
          />
        </form>
      ) : null}
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail === null ? null : (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          )}
        </p>
      )}
    </section>
  );
}

interface StepRowProps {
  step: CardStep;
  isFirst: boolean;
  isLast: boolean;
  canEdit: boolean;
  /** The words being typed in place of the step's, or null when it is not being changed. */
  editing: string | null;
  onTick: () => void;
  onEdit: () => void;
  onEditChange: (body: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  onDelete: () => void;
  onUp: () => void;
  onDown: () => void;
}

function StepRow({
  step,
  isFirst,
  isLast,
  canEdit,
  editing,
  onTick,
  onEdit,
  onEditChange,
  onEditSave,
  onEditCancel,
  onDelete,
  onUp,
  onDown,
}: StepRowProps) {
  const { t } = useTranslation();
  const isDone = step.done_at !== null;

  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onEditSave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onEditCancel();
    }
  };

  return (
    <li className="flex items-center gap-1 border-b border-border/60 last:border-b-0">
      <label className="flex min-h-11 flex-1 cursor-pointer items-start gap-2 py-2">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0"
          checked={isDone}
          disabled={!canEdit}
          onChange={onTick}
        />
        {editing === null ? (
          <span
            className={cn('text-sm break-words', isDone && 'text-muted-foreground line-through')}
          >
            {step.body}
          </span>
        ) : (
          <span className="sr-only">{step.body}</span>
        )}
      </label>
      {editing === null ? null : (
        <Input
          autoFocus
          value={editing}
          maxLength={BOARD_LIMITS.step}
          aria-label={t('boards.editStep')}
          onChange={(event) => onEditChange(event.target.value)}
          onKeyDown={keys}
          onBlur={onEditSave}
          className="h-11 flex-[3]"
        />
      )}
      {canEdit && editing === null ? (
        <div className="flex shrink-0">
          <IconButton label={t('boards.stepUp')} disabled={isFirst} onClick={onUp}>
            <ArrowUp aria-hidden="true" />
          </IconButton>
          <IconButton label={t('boards.stepDown')} disabled={isLast} onClick={onDown}>
            <ArrowDown aria-hidden="true" />
          </IconButton>
          <IconButton label={t('boards.editStep')} onClick={onEdit}>
            <Pencil aria-hidden="true" />
          </IconButton>
          <IconButton label={t('boards.deleteStep')} onClick={onDelete}>
            <Trash2 aria-hidden="true" />
          </IconButton>
        </div>
      ) : null}
    </li>
  );
}

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="size-11"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
