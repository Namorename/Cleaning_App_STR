'use client';

import {
  PLAN_STEP_KINDS,
  PLAN_STEP_ROLES,
  QUALITY_THEME_CODES,
  type PlanStepKind,
} from '@str-ops/shared';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import type { Staff } from '@/features/problems/schema';

import {
  changeStep,
  groupByTheme,
  newStep,
  proposeSteps,
  type DraftStep,
  type StepChange,
} from './draft-model';
import { PLAN_PRIORITIES, type PlanPriority } from './schema';
import { useStepWords } from './step-words';

interface StepRowProps {
  step: DraftStep;
  staff: readonly Staff[];
  refusal: string | undefined;
  onChange: (change: StepChange) => void;
  onRemove: () => void;
}

function StepRow({ step, staff, refusal, onChange, onRemove }: StepRowProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const people = staff.filter((person) => PLAN_STEP_ROLES[step.kind].includes(person.role));
  const isLinked = step.linked_problem_id !== null;

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isLinked ? <Badge tone="assigned">{t('panel.plans.step.linked')}</Badge> : <span />}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t('panel.plans.step.remove', { title: step.title })}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[10rem_1fr]">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${baseId}-kind`}>{t('panel.plans.step.kind')}</Label>
          <NativeSelect
            id={`${baseId}-kind`}
            className="h-11 px-3"
            value={step.kind}
            disabled={isLinked}
            onChange={(event) => onChange({ kind: event.target.value as PlanStepKind })}
          >
            {PLAN_STEP_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`panel.plans.kinds.${kind}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`${baseId}-title`}>{t('panel.plans.step.title')}</Label>
          <Input
            id={`${baseId}-title`}
            className="h-11"
            maxLength={200}
            value={step.title}
            disabled={isLinked}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>
      </div>
      {isLinked ? null : (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${baseId}-notes`}>{t('panel.plans.step.description')}</Label>
            <Textarea
              id={`${baseId}-notes`}
              maxLength={2000}
              value={step.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor={`${baseId}-who`}>{t('panel.plans.step.assignee')}</Label>
              <NativeSelect
                id={`${baseId}-who`}
                className="h-11 min-w-0 px-3"
                value={step.assignee_id ?? ''}
                onChange={(event) => onChange({ assignee_id: event.target.value || null })}
              >
                <option value="">{t('panel.plans.step.nobody')}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name ?? t('panel.problems.unknownPerson')}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${baseId}-due`}>{t('panel.plans.step.due')}</Label>
              <Input
                id={`${baseId}-due`}
                type="date"
                className="h-11"
                value={step.due_on ?? ''}
                onChange={(event) => onChange({ due_on: event.target.value || null })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${baseId}-priority`}>{t('panel.plans.step.priority')}</Label>
              <NativeSelect
                id={`${baseId}-priority`}
                className="h-11 px-3"
                value={step.priority}
                onChange={(event) =>
                  onChange({ priority: event.target.value as PlanPriority })
                }
              >
                {PLAN_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`problems.priorities.${priority}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </>
      )}
      {refusal === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {t(`panel.plans.refusal.${refusal}`)}
        </p>
      )}
    </li>
  );
}

interface AddThemeProps {
  held: readonly string[];
  onAdd: (theme: string) => void;
}

function AddTheme({ held, onAdd }: AddThemeProps) {
  const { t } = useTranslation();
  const id = useId();
  const [theme, setTheme] = useState('');
  const options = QUALITY_THEME_CODES.filter((code) => !held.includes(code))
    .map((code) => ({ code, name: t(`panel.quality.themes.${code}`) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id}>{t('panel.plans.addThemeLabel')}</Label>
        <NativeSelect
          id={id}
          className="h-11 min-w-0 px-3"
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
        >
          <option value="">{t('panel.plans.chooseTheme')}</option>
          {options.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11"
        disabled={theme === ''}
        onClick={() => {
          onAdd(theme);
          setTheme('');
        }}
      >
        {t('panel.plans.addThemeAction')}
      </Button>
    </div>
  );
}

interface PlanStepsEditorProps {
  steps: readonly DraftStep[];
  staff: readonly Staff[];
  /** Why a launch refused each step, by its id. */
  refusals: ReadonlyMap<string, string>;
  /** What each theme's heading says about it: «3 жалобы · 2 находки». */
  themeFacts: (theme: string) => string | null;
  onChange: (steps: DraftStep[]) => void;
}

/** The steps of a draft, by theme: everything in it is the manager's to change. */
export function PlanStepsEditor({
  steps,
  staff,
  refusals,
  themeFacts,
  onChange,
}: PlanStepsEditorProps) {
  const { t } = useTranslation();
  const words = useStepWords();
  const makeId = () => crypto.randomUUID();
  const roleOf = (personId: string) =>
    staff.find((person) => person.id === personId)?.role ?? null;
  const groups = groupByTheme(steps);

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ theme, steps: inTheme }) => {
        const name = t(`panel.quality.themes.${theme}`, { defaultValue: theme });
        const facts = themeFacts(theme);
        return (
          <section
            key={theme}
            aria-label={name}
            className="flex min-w-0 flex-col gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold break-words">{name}</h2>
              {facts === null ? null : (
                <p className="text-sm text-muted-foreground">{facts}</p>
              )}
            </header>
            <ul className="flex flex-col gap-2">
              {inTheme.map((step) => (
                <StepRow
                  key={step.id}
                  step={step}
                  staff={staff}
                  refusal={refusals.get(step.id)}
                  onChange={(change) => onChange(changeStep(steps, step.id, change, roleOf))}
                  onRemove={() => onChange(steps.filter((other) => other.id !== step.id))}
                />
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="h-11 self-start"
              onClick={() => onChange([...steps, newStep(theme, 'repair', words, makeId)])}
            >
              {t('panel.plans.step.add')}
            </Button>
          </section>
        );
      })}
      <AddTheme
        held={groups.map((group) => group.theme)}
        onAdd={(theme) => onChange([...steps, ...proposeSteps([theme], [], words, makeId)])}
      />
    </div>
  );
}
