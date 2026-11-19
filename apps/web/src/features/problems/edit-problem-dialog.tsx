'use client';

import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { serverErrorText } from '@/lib/server-error';

import { MAX_PROBLEM_DESCRIPTION, MAX_PROBLEM_TITLE, type Problem } from './schema';
import { useEditProblemText } from './use-problems';

interface EditProblemButtonProps {
  problem: Pick<Problem, 'id' | 'title' | 'description'>;
}

/**
 * «Изменить» on any task (the owner's request of 2026-11-19): the office renames it and rewrites
 * its description, whoever reported it — a cleaner, a technician, a guest's signal — and in any
 * status. The server lets the office through and nobody else (edit_problem_text).
 */
export function EditProblemButton({ problem }: EditProblemButtonProps) {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" />
        {t('panel.problems.edit.open')}
      </Button>
      {/* Mounted while open only, so each opening starts from the task as it is now. */}
      {isOpen ? <EditProblemDialog problem={problem} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

interface EditProblemDialogProps extends EditProblemButtonProps {
  onClose: () => void;
}

function EditProblemDialog({ problem, onClose }: EditProblemDialogProps) {
  const { t } = useTranslation();
  const edit = useEditProblemText();
  const [title, setTitle] = useState(problem.title);
  const [description, setDescription] = useState(problem.description ?? '');
  const failure = edit.isError ? serverErrorText(edit.error) : null;
  const isBlank = title.trim() === '';

  const save = (event: FormEvent) => {
    event.preventDefault();
    edit.mutate(
      { problemId: problem.id, title: title.trim(), description: description.trim() },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next || edit.isPending ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('panel.problems.edit.title')}</DialogTitle>
          <DialogDescription>{t('panel.problems.edit.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-problem-title">{t('problems.titleLabel')}</Label>
            <Input
              id="edit-problem-title"
              value={title}
              maxLength={MAX_PROBLEM_TITLE}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-problem-description">{t('problems.descriptionLabel')}</Label>
            <Textarea
              id="edit-problem-description"
              rows={5}
              value={description}
              maxLength={MAX_PROBLEM_DESCRIPTION}
              onChange={(event) => setDescription(event.target.value)}
            />
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
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={edit.isPending}
              onClick={onClose}
            >
              {t('panel.problems.form.close')}
            </Button>
            <Button type="submit" className="h-11" disabled={edit.isPending || isBlank}>
              {edit.isPending ? t('panel.problems.edit.saving') : t('panel.problems.edit.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
