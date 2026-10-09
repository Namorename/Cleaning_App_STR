import type { Language } from '@str-ops/shared';

/**
 * The privacy policy's values that only the owner knows but that are not
 * personal: dates, periods, regions, the export format, and the two
 * statements the draft leaves in square brackets. `null` means «not given
 * yet», and the page then shows, in bold, what to write there
 * (docs/privacy-policy-draft.md, the last section: how to fill the page in).
 *
 * The operator's own details — name, IČO, address, e-mail — are NOT here: the
 * repository is public, so they come from server-only environment variables
 * (`operator.ts`).
 *
 * To fill a value: write it below, commit, and let the deployment carry it —
 * a push to `main` is the panel's production deployment (CLAUDE.md).
 */

/** Text in each of the page's languages: a region or a role reads differently in each. */
export type LocalizedText = Readonly<Record<Language, string>>;

/** A calendar day, `YYYY-MM-DD`; the page writes it out in the reader's language. */
export type IsoDate = `${number}-${number}-${number}`;

export interface PrivacySettings {
  /** «Effective from»: the day this text takes effect. */
  readonly effectiveDate: IsoDate | null;
  /** By when automatic deletion after 12 / 24 months is introduced (F24). */
  readonly automaticDeletionDate: IsoDate | null;
  /** By when a switched-off account can no longer sign in. */
  readonly signInBlockDate: IsoDate | null;
  /** Who deletes an account by hand, e.g. «the company's administrator». */
  readonly accountDeletedBy: LocalizedText | null;
  /** How many months after the switch-off an account is deleted. */
  readonly accountRetentionMonths: number | null;
  /** Where Vercel hosts the panel, as the project's settings show it. */
  readonly vercelRegion: LocalizedText | null;
  /** Where Sentry keeps the crash reports, as chosen with the project. */
  readonly sentryRegion: LocalizedText | null;
  /** How long the suppliers keep the server logs, e.g. «up to 7 days». */
  readonly serverLogRetention: LocalizedText | null;
  /** The file a person's data is exported to on request. */
  readonly exportFormat: 'CSV' | 'JSON' | null;
  /** `true` once data processing agreements are signed with every supplier. */
  readonly processingAgreementsSigned: true | null;
  /** `true` once the basis of every transfer to the USA is checked. */
  readonly transferBasisChecked: true | null;
}

export const PRIVACY_SETTINGS: PrivacySettings = {
  effectiveDate: null,
  automaticDeletionDate: null,
  signInBlockDate: null,
  accountDeletedBy: null,
  accountRetentionMonths: null,
  vercelRegion: null,
  sentryRegion: null,
  serverLogRetention: null,
  exportFormat: null,
  processingAgreementsSigned: null,
  transferBasisChecked: null,
};
