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

/**
 * The owner's values of 2026-10-10. Where one was looked up rather than given,
 * the source is beside it.
 */
export const PRIVACY_SETTINGS: PrivacySettings = {
  effectiveDate: '2026-10-12',
  automaticDeletionDate: '2027-03-31',
  signInBlockDate: '2026-11-30',
  // The operator, on a letter to the address in section 1 (the sentence says how).
  accountDeletedBy: { cs: 'správce', en: 'the controller', ru: 'оператор' },
  accountRetentionMonths: 6,
  // The project's functions run in fra1, Frankfurt, beside the database: pinned
  // in apps/web/vercel.json (owner, 2026-10-10, Pro plan). Before it they ran in
  // iad1, Vercel's default. A test keeps the two in step.
  // https://vercel.com/docs/functions/configuring-functions/region
  vercelRegion: { cs: 'EU (Frankfurt)', en: 'EU (Frankfurt)', ru: 'ЕС (Франкфурт)' },
  // The DSN's ingest host is in .de.sentry.io: Sentry's EU region, Frankfurt.
  // https://docs.sentry.io/organization/data-storage-location/
  sentryRegion: { cs: 'EU (Frankfurt)', en: 'EU (Frankfurt)', ru: 'ЕС (Франкфурт)' },
  // Supabase keeps API and database logs 1 day on Free, 7 on Pro
  // (https://supabase.com/pricing); Vercel its runtime logs 1 hour on Hobby,
  // 1 day on Pro (https://vercel.com/docs/logs/runtime). Seven days holds on
  // either plan.
  serverLogRetention: {
    cs: 'nejvýše 7 dní',
    en: 'no longer than 7 days',
    ru: 'не дольше 7 дней',
  },
  exportFormat: 'CSV',
  // Confirmed by the owner on 2026-10-10, 21:00: Sentry's agreement accepted in
  // its settings, Supabase's and Vercel's part of their terms, Expo's in its
  // terms' processing section; each carries the standard contractual clauses
  // (docs/privacy-dpa-links.md).
  processingAgreementsSigned: true,
  transferBasisChecked: true,
};
