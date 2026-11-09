'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

import { liveFixTask, type Problem, type Worker } from './schema';
import { useWorkers } from './use-problems';

/** The select's value for «Никто, менеджер сам». */
const ALONE = '';

interface ResolveDialogProps {
  open: boolean;
  /** The task being closed; kept while the dialog fades out. */
  problem: Problem | null;
  /** The request is on its way. */
  isBusy: boolean;
  /** Who did the work; null: nobody, the manager did it alone. */
  onConfirm: (completedBy: string | null) => void;
  onClose: () => void;
}

interface Choice {
  id: string;
  name: string;
}

/**
 * The people to choose from: the technicians at work, the one holding the repair first among
 * them (even a cleaner it was given to), then those switched off — a person who left can
 * still be named.
 */
function choicesFor(
  workers: readonly Worker[],
  problem: Problem | null,
  words: { unknown: string; holder: string },
): { active: Choice[]; switchedOff: Choice[] } {
  const live = problem === null ? null : liveFixTask(problem);
  const holderId = live?.assignee_id ?? null;
  const named = (id: string, name: string | null | undefined): Choice => ({
    id,
    name: `${name ?? words.unknown}${id === holderId ? ` · ${words.holder}` : ''}`,
  });
  const active = workers.filter((worker) => worker.is_active).map((w) => named(w.id, w.full_name));
  const switchedOff = workers
    .filter((worker) => !worker.is_active)
    .map((w) => named(w.id, w.full_name));
  const isListed = holderId === null || workers.some((worker) => worker.id === holderId);
  const holder = isListed ? [] : [named(holderId, live?.assignee?.full_name)];
  const holderFirst = (list: Choice[]) => [
    ...list.filter((choice) => choice.id === holderId),
    ...list.filter((choice) => choice.id !== holderId),
  ];
  return { active: [...holder, ...holderFirst(active)], switchedOff };
}

/**
 * «Отметить выполненным?» with «Кто выполнил» (owner, 09.11): «Никто, менеджер сам» unless the
 * manager names somebody. Naming her finishes the work in her name; nobody hears of it.
 */
export function ResolveDialog({ open, problem, isBusy, onConfirm, onClose }: ResolveDialogProps) {
  const { t } = useTranslation();
  const workers = useWorkers();
  const [choice, setChoice] = useState(ALONE);
  const [isSent, setIsSent] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setChoice(ALONE);
      setIsSent(false);
    }
  }

  const { active, switchedOff } = choicesFor(workers.data ?? [], problem, {
    unknown: t('panel.problems.unknownPerson'),
    holder: t('panel.problems.resolveDialog.holder'),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('panel.problems.board.resolveTitle')}</DialogTitle>
          <DialogDescription>
            {t('panel.problems.board.resolveText', { title: problem?.title ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resolve-who">{t('panel.problems.resolveDialog.who')}</Label>
          <NativeSelect
            id="resolve-who"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="h-11 px-3"
          >
            <option value={ALONE}>{t('panel.problems.resolveDialog.alone')}</option>
            {active.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
            {switchedOff.length === 0 ? null : (
              <optgroup label={t('panel.problems.resolveDialog.switchedOff')}>
                {switchedOff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
          {choice === ALONE ? null : (
            <p className="text-sm text-muted-foreground">
              {t('panel.problems.resolveDialog.hint')}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {t('panel.problems.board.resolveAbort')}
          </Button>
          <Button
            type="button"
            className="h-11"
            disabled={isBusy || isSent}
            onClick={() => {
              setIsSent(true);
              onConfirm(choice === ALONE ? null : choice);
            }}
          >
            {t('panel.problems.board.resolveConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
