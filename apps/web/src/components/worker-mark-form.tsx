'use client';

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { ServerErrorText } from '@/lib/server-error';

import type { WhoDidItPerson } from './who-did-it-dialog';

interface WorkerMarkFormProps {
  /** Where the field stands; makes its id unique on the page. */
  id: string;
  people: readonly WhoDidItPerson[];
  isBusy: boolean;
  failure: ServerErrorText | null;
  onSave: (personId: string) => void;
}

/**
 * «Указать исполнителя» on a closed job that says «не указано» (owner, 09.11): one field and its
 * button. It adds the worker and nothing else — no status, no date, no push.
 */
export function WorkerMarkForm({ id, people, isBusy, failure, onSave }: WorkerMarkFormProps) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState('');
  const fieldId = `worker-mark-${id}`;
  const active = people.filter((person) => person.isActive);
  const switchedOff = people.filter((person) => !person.isActive);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (choice !== '') {
      onSave(choice);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{t('panel.workerMark.label')}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          id={fieldId}
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          className="h-11 min-w-0 flex-1 px-3"
        >
          <option value="">{t('panel.workerMark.choose')}</option>
          {active.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
          {switchedOff.length === 0 ? null : (
            <optgroup label={t('panel.workerMark.switchedOff')}>
              {switchedOff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </optgroup>
          )}
        </NativeSelect>
        <Button type="submit" className="h-11" disabled={choice === '' || isBusy}>
          {t('panel.workerMark.save')}
        </Button>
      </div>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
        </p>
      )}
    </form>
  );
}
