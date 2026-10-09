'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { propertyOptions } from '@/features/tasks/schema';
import { useProperties } from '@/features/tasks/use-tasks';
import { serverErrorText } from '@/lib/server-error';

import { problemHref, type ProblemView } from './address';
import {
  MAX_PROBLEM_DESCRIPTION,
  MAX_PROBLEM_TITLE,
  PROBLEM_PRIORITIES,
  type Problem,
  type ProblemPriority,
} from './schema';
import { useReportProblem } from './use-problems';

interface Draft {
  title: string;
  description: string;
  priority: ProblemPriority;
  propertyId: number | null;
}

const EMPTY_DRAFT: Draft = { title: '', description: '', priority: 'normal', propertyId: null };

interface NewProblemDialogProps {
  /** The view the form was opened from: the new task's page returns to it. */
  view: ProblemView;
  onClose: () => void;
}

/**
 * «Новое задание»: the office writes a task itself — what happened, where,
 * how urgent — and lands on its page, where it is handed to a technician.
 *
 * Mounted only while it is open, so every opening is a clean draft with an id
 * of its own: a press repeated after a lost answer sends the same id, and the
 * server hands back the row the first one made instead of a second task.
 * Photos stay with the phone, which takes them on the spot.
 */
export function NewProblemDialog({ view, onClose }: NewProblemDialogProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const properties = useProperties();
  const report = useReportProblem();
  const [problemId] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  // Sorted and composed once per list, not once per keystroke.
  const places = useMemo(() => propertyOptions(properties.data ?? []), [properties.data]);

  const isReady = draft.title.trim() !== '';
  const failure = report.isError ? serverErrorText(report.error) : null;
  // An archived task is never new: from the archive, the page returns to the board.
  const backTo: ProblemView = view === 'archive' ? 'board' : view;

  const opened = (problem: Pick<Problem, 'id'>) => {
    onClose();
    router.push(problemHref(problem.id, backTo));
  };

  // The disabled button is what the manager sees; the handler asks the same
  // question, so a submit that reaches the form some other way sends nothing.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isReady || report.isPending) {
      return;
    }
    report.mutate(
      {
        problemId,
        title: draft.title.trim(),
        description: draft.description.trim(),
        priority: draft.priority,
        propertyId: draft.propertyId,
      },
      { onSuccess: opened },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('panel.problems.form.title')}</DialogTitle>
          <DialogDescription>{t('panel.problems.form.description')}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1">
            <Label htmlFor="problem-property">{t('panel.problems.form.property')}</Label>
            <NativeSelect
              id="problem-property"
              value={draft.propertyId ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  propertyId: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            >
              <option value="">{t('problems.noProperty')}</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="problem-title">{t('problems.titleLabel')}</Label>
            <Input
              id="problem-title"
              value={draft.title}
              maxLength={MAX_PROBLEM_TITLE}
              placeholder={t('problems.titlePlaceholder')}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="problem-description">{t('problems.descriptionLabel')}</Label>
            <Textarea
              id="problem-description"
              rows={3}
              value={draft.description}
              maxLength={MAX_PROBLEM_DESCRIPTION}
              placeholder={t('problems.descriptionPlaceholder')}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="problem-priority">{t('problems.priorityLabel')}</Label>
            <NativeSelect
              id="problem-priority"
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as ProblemPriority })
              }
            >
              {PROBLEM_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {t(`problems.priorities.${priority}`)}
                </option>
              ))}
            </NativeSelect>
          </div>

          {failure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {failure.text}
              {failure.detail === null ? null : (
                <span className="block text-xs text-muted-foreground">{failure.detail}</span>
              )}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              {t('panel.problems.form.close')}
            </Button>
            <Button type="submit" className="h-11" disabled={report.isPending || !isReady}>
              {report.isPending ? t('panel.problems.form.saving') : t('panel.problems.form.submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
