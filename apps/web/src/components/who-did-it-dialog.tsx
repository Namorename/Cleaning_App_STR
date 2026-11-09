'use client';

import { useState } from 'react';

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

/** The select's value for «Никто, менеджер сам». */
const ALONE = '';

/** Somebody who may have done the work, as the select names her. */
export interface WhoDidItPerson {
  id: string;
  name: string;
  isActive: boolean;
}

export interface WhoDidItWorker {
  id: string;
  full_name: string | null;
  is_active: boolean;
}

/**
 * The people to choose from: those at work, the one holding the job first among them (even of
 * another role), then those switched off — a person who left can still be named.
 */
export function workerChoices(
  workers: readonly WhoDidItWorker[],
  holder: { id: string; name: string | null } | null,
  words: { unknown: string; holder: string },
): WhoDidItPerson[] {
  const named = (id: string, name: string | null, isActive: boolean): WhoDidItPerson => ({
    id,
    name: `${name ?? words.unknown}${id === holder?.id ? ` · ${words.holder}` : ''}`,
    isActive,
  });
  const listed = workers.map((worker) => named(worker.id, worker.full_name, worker.is_active));
  const missing =
    holder === null || workers.some((worker) => worker.id === holder.id)
      ? []
      : [named(holder.id, holder.name, true)];
  return [
    ...missing,
    ...listed.filter((person) => person.id === holder?.id),
    ...listed.filter((person) => person.id !== holder?.id),
  ];
}

export interface WhoDidItWords {
  title: string;
  description: string;
  who: string;
  alone: string;
  switchedOff: string;
  hint: string;
  confirm: string;
  abort: string;
}

interface WhoDidItDialogProps {
  open: boolean;
  words: WhoDidItWords;
  people: readonly WhoDidItPerson[];
  /** The request is on its way. */
  isBusy: boolean;
  /** Who did the work; null: nobody, the manager did it alone. */
  onConfirm: (completedBy: string | null) => void;
  onClose: () => void;
}

/**
 * «Кто выполнил» before a manager closes a job by hand (owner, 09.11): «Никто, менеджер сам»
 * unless he names somebody. The dialog closes once the server has answered; until then its
 * button takes one press.
 */
export function WhoDidItDialog({
  open,
  words,
  people,
  isBusy,
  onConfirm,
  onClose,
}: WhoDidItDialogProps) {
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

  const active = people.filter((person) => person.isActive);
  const switchedOff = people.filter((person) => !person.isActive);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{words.title}</DialogTitle>
          <DialogDescription>{words.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="who-did-it">{words.who}</Label>
          <NativeSelect
            id="who-did-it"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="h-11 px-3"
          >
            <option value={ALONE}>{words.alone}</option>
            {active.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
            {switchedOff.length === 0 ? null : (
              <optgroup label={words.switchedOff}>
                {switchedOff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </optgroup>
            )}
          </NativeSelect>
          {choice === ALONE ? null : <p className="text-sm text-muted-foreground">{words.hint}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="h-11" onClick={onClose}>
            {words.abort}
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
            {words.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
