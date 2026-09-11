'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProperties } from '@/features/team/use-team';

import { WORKFLOW_SCOPES, type WorkflowScope } from './schema';
import { useProcess } from './use-workflow';
import { WorkflowBuilder } from './workflow-builder';

const SELECT_CLASS = 'h-9 rounded-md border bg-background px-2 text-sm';

/** No listing chosen yet — the empty value of the picker. */
const NO_PROPERTY = '';

/**
 * Which process is being edited, and for whom.
 *
 * Two questions before the editor, because the answer to the second changes
 * what the first one means. A process belongs to a kind of task — a cleaning,
 * or fixing a reported problem — and it applies either to the whole company
 * or to one listing that needs something different.
 *
 * The banner above the editor says which of the three situations a listing is
 * in: it has its own process, it has one that is switched off, or it is
 * following somebody else's. The third is the one worth naming out loud —
 * `resolve_workflow_template` falls back silently, and a manager editing what
 * looks like this flat's steps would in fact be creating them.
 *
 * The listing picker is the team's, which leaves the archive out. An archived
 * listing takes no cleanings at all, so a process for one would be a setting
 * with nothing to act on.
 */
export function ProcessSection() {
  const { t } = useTranslation();
  const properties = useProperties();

  const [scope, setScope] = useState<WorkflowScope>(WORKFLOW_SCOPES[0]);
  const [propertyId, setPropertyId] = useState<string>(NO_PROPERTY);
  const [perProperty, setPerProperty] = useState(false);

  const target = perProperty && propertyId !== NO_PROPERTY ? Number(propertyId) : null;
  const process = useProcess(scope, target);

  const source = process.data ?? null;
  const template = source?.template ?? null;
  const isOwn = template !== null && template.property_id === target;

  const banner = (): string | null => {
    if (template === null) {
      return t('panel.settings.workflow.none');
    }
    if (target === null) {
      return null;
    }
    if (!isOwn) {
      return t('panel.settings.workflow.inherited', { name: template.name });
    }
    return template.is_active
      ? t('panel.settings.workflow.own')
      : t('panel.settings.workflow.paused');
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('panel.settings.workflow.scope')}
          <select
            className={SELECT_CLASS}
            aria-label={t('panel.settings.workflow.scope')}
            value={scope}
            onChange={(event) => setScope(event.target.value as WorkflowScope)}
          >
            {WORKFLOW_SCOPES.map((one) => (
              <option key={one} value={one}>
                {t(`panel.settings.workflow.scopes.${one}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('panel.settings.workflow.target')}
          <select
            className={SELECT_CLASS}
            aria-label={t('panel.settings.workflow.target')}
            value={perProperty ? 'property' : 'default'}
            onChange={(event) => setPerProperty(event.target.value === 'property')}
          >
            <option value="default">{t('panel.settings.workflow.targetDefault')}</option>
            <option value="property">{t('panel.settings.workflow.targetProperty')}</option>
          </select>
        </label>

        {perProperty ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('panel.settings.workflow.property')}
            <select
              className={SELECT_CLASS}
              aria-label={t('panel.settings.workflow.property')}
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value={NO_PROPERTY}>
                {t('panel.settings.workflow.propertyPlaceholder')}
              </option>
              {(properties.data ?? []).map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {perProperty && target === null ? (
        <p className="text-sm text-muted-foreground">
          {t('panel.settings.workflow.propertyPlaceholder')}
        </p>
      ) : process.isPending ? (
        <p className="text-sm text-muted-foreground">{t('panel.settings.workflow.loading')}</p>
      ) : process.isError || source === null ? (
        <p role="alert" className="text-sm text-destructive">
          {t('panel.settings.workflow.loadError')}
        </p>
      ) : (
        <>
          {banner() === null ? null : (
            <p role="status" className="rounded-md border p-2 text-sm">
              {banner()}
            </p>
          )}

          {/* A new key remounts the editor, so a draft never survives a change
              of target — what is on screen always belongs to what is chosen. */}
          <WorkflowBuilder
            key={`${scope}:${target ?? 'default'}`}
            source={source}
            scope={scope}
            propertyId={target}
          />
        </>
      )}
    </div>
  );
}
