'use client';

import { QUALITY_THEME_CODES } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { serverErrorText } from '@/lib/server-error';

import { useProblemTheme, useSetProblemTheme } from './use-problem-theme';

const NO_THEME = '';

/**
 * What the task is about (docs/property-intelligence-plan.md §4.5). The dictionary or the
 * finding names it; the manager's choice outranks both and the night leaves it alone.
 */
export function ProblemThemeBlock({ problemId }: { problemId: string }) {
  const { t } = useTranslation();
  const read = useProblemTheme(problemId);
  const write = useSetProblemTheme(problemId);
  const failure = write.isError ? serverErrorText(write.error) : null;
  const options = QUALITY_THEME_CODES.map((code) => ({
    code,
    name: t(`panel.quality.themes.${code}`),
  })).sort((a, b) => a.name.localeCompare(b.name));

  if (read.isError) {
    return <p className="text-muted-foreground">{t('panel.problems.detail.theme.loadError')}</p>;
  }

  const current = read.data ?? null;
  return (
    <section className="flex flex-col gap-1.5">
      <label htmlFor="problem-theme" className="font-medium">
        {t('panel.problems.detail.theme.title')}
      </label>
      <NativeSelect
        id="problem-theme"
        value={current?.theme ?? NO_THEME}
        disabled={read.isPending || write.isPending}
        onChange={(event) => write.mutate(event.target.value)}
        className="h-11 px-3"
      >
        {current === null ? (
          <option value={NO_THEME}>{t('panel.problems.detail.theme.none')}</option>
        ) : null}
        {options.map(({ code, name }) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </NativeSelect>
      {current === null ? null : (
        <p className="text-xs text-muted-foreground">
          {t(`panel.problems.detail.theme.source.${current.source}`)}
        </p>
      )}
      {current?.source === 'manual' ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          disabled={write.isPending}
          onClick={() => write.mutate(null)}
        >
          {t('panel.problems.detail.theme.reset')}
        </Button>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('panel.problems.detail.theme.hint')}</p>
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail !== null ? (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
