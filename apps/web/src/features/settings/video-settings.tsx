'use client';

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { serverErrorHint, serverErrorParams, serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import type { HostSettings } from './schema';
import { useHostSettings, useSaveHostSettings } from './use-settings';
import {
  FREE_PLAN_FILE_MB,
  secondsUntilFull,
  VIDEO_BOUNDS,
  VIDEO_FIELDS,
  VIDEO_PRESETS,
  videoFieldOfColumn,
  videoFieldValue,
  videoSizeMb,
  type VideoField,
  type VideoLimits,
  type VideoPreset,
} from './video';

type VideoDraft = Record<VideoField, string>;

const FIELD_LABEL_KEY: Record<VideoField, string> = {
  maxSec: 'panel.settings.video.maxSec',
  bitrateKbps: 'panel.settings.video.bitrateKbps',
  maxMb: 'panel.settings.video.maxMb',
};

const PRESETS = Object.keys(VIDEO_PRESETS) as VideoPreset[];

const OUT_OF_RANGE = 'serverErrors.videoSettingOutOfRange';

function draftOf(limits: VideoLimits): VideoDraft {
  return {
    maxSec: String(limits.maxSec),
    bitrateKbps: String(limits.bitrateKbps),
    maxMb: String(limits.maxMb),
  };
}

function draftFromHost(host: HostSettings): VideoDraft {
  return draftOf({
    maxSec: host.video_max_sec,
    bitrateKbps: host.video_bitrate_kbps,
    maxMb: host.video_max_mb,
  });
}

/** The three numbers when every one is whole and within its bounds. */
function limitsOf(draft: VideoDraft): VideoLimits | null {
  const maxSec = videoFieldValue('maxSec', draft.maxSec);
  const bitrateKbps = videoFieldValue('bitrateKbps', draft.bitrateKbps);
  const maxMb = videoFieldValue('maxMb', draft.maxMb);
  return maxSec === null || bitrateKbps === null || maxMb === null
    ? null
    : { maxSec, bitrateKbps, maxMb };
}

/**
 * «Настройки → Процесс → Видео» (docs/tech-plan.md, 7.1 and 9): how long a
 * video on a step may run, the bitrate the phone gives its camera, and the
 * largest file the server accepts. The phone reads them with the gallery
 * switch, so moving to Supabase Pro is three numbers here — no build, no OTA.
 */
export function VideoSettings() {
  const { t } = useTranslation();
  const headingId = useId();
  const settings = useHostSettings();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 border-t pt-4">
      <header className="flex flex-col gap-1">
        <h3 id={headingId} className="font-semibold">
          {t('panel.settings.video.title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('panel.settings.video.hint')}</p>
      </header>
      {settings.isPending ? (
        <LoadingState>{t('panel.settings.workflow.loading')}</LoadingState>
      ) : settings.isError || settings.data === null || settings.data === undefined ? (
        <ErrorState message={t('panel.settings.loadError')} error={settings.error} />
      ) : (
        <VideoForm host={settings.data} />
      )}
    </section>
  );
}

/**
 * The three numbers, saved together and only they: the switches of
 * «Компания» stay out of the call, which `update_host_settings` reads as
 * "leave them alone". The bounds are checked here before the server checks
 * them again; a preset only fills the fields — the save is still a press.
 */
function VideoForm({ host }: { host: HostSettings }) {
  const { t } = useTranslation();
  const id = useId();
  const save = useSaveHostSettings();
  /** Null until the manager touches a field — until then the company's numbers show. */
  const [draft, setDraft] = useState<VideoDraft | null>(null);

  const shown = draft ?? draftFromHost(host);
  const limits = limitsOf(shown);

  const submit = () => {
    if (limits === null) {
      return;
    }
    save.mutate(
      {
        videoMaxSec: limits.maxSec,
        videoBitrateKbps: limits.bitrateKbps,
        videoMaxMb: limits.maxMb,
      },
      { onSuccess: () => setDraft(null) },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant="outline"
            className="h-auto min-h-8 py-1 text-left whitespace-normal"
            onClick={() => setDraft(draftOf(VIDEO_PRESETS[preset]))}
          >
            {t(`panel.settings.video.presets.${preset}`, {
              sec: VIDEO_PRESETS[preset].maxSec,
              kbps: VIDEO_PRESETS[preset].bitrateKbps,
              mb: VIDEO_PRESETS[preset].maxMb,
            })}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {VIDEO_FIELDS.map((field) => (
          <VideoFieldInput
            key={field}
            id={`${id}-${field}`}
            field={field}
            value={shown[field]}
            onChange={(value) => setDraft({ ...shown, [field]: value })}
          />
        ))}
      </div>

      <SizeNotes draft={shown} />

      <SaveFailure error={save.isError ? save.error : null} />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={draft === null || limits === null || save.isPending}
          onClick={submit}
        >
          {save.isPending ? t('panel.settings.saving') : t('panel.settings.video.save')}
        </Button>
        {draft === null ? null : (
          <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
            {t('panel.settings.workflow.cancel')}
          </Button>
        )}
        {save.isSuccess && draft === null && !save.isPending ? (
          <span role="status" className="text-sm text-muted-foreground">
            {t('panel.settings.saved')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface VideoFieldInputProps {
  id: string;
  field: VideoField;
  value: string;
  onChange: (value: string) => void;
}

/** One number, with its bounds said under it — in red once the value is outside them. */
function VideoFieldInput({ id, field, value, onChange }: VideoFieldInputProps) {
  const { t } = useTranslation();
  const isInvalid = videoFieldValue(field, value) === null;
  const ruleId = `${id}-rule`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {t(FIELD_LABEL_KEY[field])}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        step={1}
        min={VIDEO_BOUNDS[field].min}
        max={VIDEO_BOUNDS[field].max}
        value={value}
        aria-invalid={isInvalid}
        aria-describedby={ruleId}
        onChange={(event) => onChange(event.target.value)}
      />
      <p
        id={ruleId}
        className={cn(
          'text-xs',
          isInvalid ? 'font-medium text-destructive' : 'text-muted-foreground',
        )}
      >
        {t('panel.settings.video.bounds', VIDEO_BOUNDS[field])}
      </p>
    </div>
  );
}

/**
 * What the numbers come to, and two warnings — neither a refusal: a
 * full-length video larger than the file limit (the camera then stops early,
 * at the limit), and a file limit above what Supabase's free plan uploads.
 */
function SizeNotes({ draft }: { draft: VideoDraft }) {
  const { t } = useTranslation();
  const sec = videoFieldValue('maxSec', draft.maxSec);
  const kbps = videoFieldValue('bitrateKbps', draft.bitrateKbps);
  const mb = videoFieldValue('maxMb', draft.maxMb);
  const fullSize = sec === null || kbps === null ? null : videoSizeMb(sec, kbps);

  return (
    <div className="flex flex-col gap-1 text-sm" aria-live="polite">
      {fullSize === null ? null : (
        <p>{t('panel.settings.video.fullSize', { mb: Math.round(fullSize) })}</p>
      )}
      {fullSize === null || mb === null || kbps === null || fullSize <= mb ? null : (
        <p className="font-medium text-destructive">
          {t('panel.settings.video.overFile', { mb, sec: secondsUntilFull(mb, kbps) })}
        </p>
      )}
      {mb === null || mb <= FREE_PLAN_FILE_MB ? null : (
        <p className="font-medium text-destructive">
          {t('panel.settings.video.freePlan', { mb: FREE_PLAN_FILE_MB })}
        </p>
      )}
    </div>
  );
}

/**
 * What the server refused, in the manager's words. A number out of bounds
 * names its field — the key's own sentence says only the bounds — and any
 * other refusal is the general phrase with the server's words under it.
 */
function SaveFailure({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error === null) {
    return null;
  }

  const failure = serverErrorText(error);
  const field =
    serverErrorHint(error) === OUT_OF_RANGE
      ? videoFieldOfColumn(serverErrorParams(error).field)
      : null;

  return (
    <div role="alert" className="flex flex-col gap-1">
      <p className="text-sm text-destructive">
        {field === null ? failure.text : `${t(FIELD_LABEL_KEY[field])}: ${failure.text}`}
      </p>
      {failure.detail === null ? null : (
        <p className="text-xs text-muted-foreground">{failure.detail}</p>
      )}
    </div>
  );
}
