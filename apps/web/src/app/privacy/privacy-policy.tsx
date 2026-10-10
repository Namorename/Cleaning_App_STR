import { translations, type Language } from '@str-ops/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageHeader } from '@/components/page-header';

import { PRIVACY_LANGUAGES, privacyHref } from './language';
import type { OperatorDetails } from './operator';
import { PolicyTable } from './policy-table';
import { LINK_CLASS, policyValues, type PolicyValues, type PrivacyTexts } from './policy-values';
import { renderRich } from './rich-text';
import type { PrivacySettings } from './settings';

interface PrivacyPolicyProps {
  language: Language;
  operator: OperatorDetails;
  settings: PrivacySettings;
}

interface SectionProps {
  texts: PrivacyTexts;
  values: PolicyValues;
}

const LIST_CLASS = 'flex list-disc flex-col gap-1 pl-5';

const DATA_ROWS = ['account', 'work', 'media', 'chat', 'requests', 'device', 'technical'] as const;

const RETENTION_ROWS = [
  'media',
  'chatPhotos',
  'records',
  'journal',
  'account',
  'pushToken',
  'crashReports',
  'serverLogs',
] as const;

/** The id of a section's heading, which also names the section and its table. */
function headingId(section: number): string {
  return `privacy-section-${section}`;
}

interface PolicySectionProps {
  /** The draft's section number, which also makes the heading's id. */
  number: number;
  heading: string;
  children: ReactNode;
}

function Section({ number, heading, children }: PolicySectionProps) {
  return (
    <section aria-labelledby={headingId(number)} className="flex flex-col gap-3">
      <h2 id={headingId(number)} className="text-xl font-semibold">
        {heading}
      </h2>
      {children}
    </section>
  );
}

function OtherLanguages({ language }: { language: Language }) {
  return (
    <nav aria-label={translations[language].privacy.otherLanguages}>
      <ul className="flex flex-wrap justify-end gap-x-4">
        {PRIVACY_LANGUAGES.filter((other) => other !== language).map((other) => (
          <li key={other}>
            <Link
              href={privacyHref(other)}
              hrefLang={other}
              lang={other}
              className={`inline-flex min-h-11 items-center text-sm ${LINK_CLASS}`}
            >
              {translations[other].common.languages[other]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function OperatorSection({ texts, values }: SectionProps) {
  return (
    <Section number={1} heading={texts.operator.heading}>
      <p>
        {renderRich(texts.operator.text, {
          name: values.name,
          id: values.id,
          address: values.address,
          email: values.email,
        })}
      </p>
    </Section>
  );
}

function DataSection({ texts }: SectionProps) {
  const { columns, rows } = texts.data;
  return (
    <Section number={2} heading={texts.data.heading}>
      <PolicyTable
        labelledBy={headingId(2)}
        columns={[columns.what, columns.examples, columns.why]}
        rows={DATA_ROWS.map((key) => ({
          key,
          header: rows[key].what,
          cells: [rows[key].examples, rows[key].why],
        }))}
      />
      <p>{renderRich(texts.data.notCollected)}</p>
      <p>{texts.data.video}</p>
      <p>{texts.data.videoGallery}</p>
    </Section>
  );
}

function BasisSection({ texts }: SectionProps) {
  const { contract, interest, permission } = texts.basis;
  return (
    <Section number={3} heading={texts.basis.heading}>
      <ul className={LIST_CLASS}>
        <li>{renderRich(contract)}</li>
        <li>{renderRich(interest)}</li>
        <li>{renderRich(permission)}</li>
      </ul>
    </Section>
  );
}

function RecipientsSection({ texts, values }: SectionProps) {
  const { columns, vendors } = texts.recipients;
  const vendorRows: readonly { name: string; role: string; location: ReactNode }[] = [
    vendors.supabase,
    { ...vendors.vercel, location: values.vercelRegion },
    vendors.expo,
    vendors.google,
    vendors.apple,
    { ...vendors.sentry, location: values.sentryRegion },
  ];
  return (
    <Section number={4} heading={texts.recipients.heading}>
      <p>{texts.recipients.intro}</p>
      <ul className={LIST_CLASS}>
        <li>{renderRich(texts.recipients.managers)}</li>
        <li>{renderRich(texts.recipients.staff)}</li>
      </ul>
      <p>{texts.recipients.processors}</p>
      <PolicyTable
        labelledBy={headingId(4)}
        columns={[columns.vendor, columns.role, columns.location]}
        rows={vendorRows.map((vendor) => ({
          key: vendor.name,
          header: vendor.name,
          cells: [vendor.role, vendor.location],
        }))}
      />
      {/* Agreements stand with four of them; Google's and Apple's terms are said as they are
          (owner's word of 2026-10-10, docs/privacy-dpa-links.md). */}
      <p>{renderRich(texts.recipients.terms, { agreements: values.processingAgreements })}</p>
      <p>{renderRich(texts.recipients.transfers, { basis: values.transferBasis })}</p>
      <p>{texts.recipients.noSale}</p>
    </Section>
  );
}

function RetentionSection({ texts, values }: SectionProps) {
  const { columns, rows, deletionEffects } = texts.retention;
  const periodSlots = {
    date: values.automaticDeletionDate,
    period: values.serverLogRetention,
  };
  return (
    <Section number={5} heading={texts.retention.heading}>
      <PolicyTable
        labelledBy={headingId(5)}
        columns={[columns.data, columns.period]}
        rows={RETENTION_ROWS.map((key) => ({
          key,
          header: rows[key].data,
          cells: [renderRich(rows[key].period, periodSlots)],
        }))}
      />
      <p>{renderRich(texts.retention.leaving, { date: values.signInBlockDate })}</p>
      <p>
        {renderRich(texts.retention.deletion, {
          who: values.accountDeletedBy,
          when: values.accountRetention,
        })}
      </p>
      <ul className={LIST_CLASS}>
        {Object.entries(deletionEffects).map(([key, effect]) => (
          <li key={key}>{renderRich(effect)}</li>
        ))}
      </ul>
    </Section>
  );
}

function NotificationsSection({ texts }: SectionProps) {
  return (
    <Section number={6} heading={texts.notifications.heading}>
      <p>{renderRich(texts.notifications.text)}</p>
    </Section>
  );
}

function RightsSection({ texts, values }: SectionProps) {
  return (
    <Section number={7} heading={texts.rights.heading}>
      <p>{texts.rights.intro}</p>
      <ul className={LIST_CLASS}>
        {Object.entries(texts.rights.items).map(([key, right]) => (
          <li key={key}>{right}</li>
        ))}
      </ul>
      <p>
        {renderRich(texts.rights.contact, { email: values.email, format: values.exportFormat })}
      </p>
      <p>{renderRich(texts.rights.complaint, { website: values.website })}</p>
    </Section>
  );
}

function SecuritySection({ texts }: SectionProps) {
  return (
    <Section number={8} heading={texts.security.heading}>
      <ul className={LIST_CLASS}>
        {Object.entries(texts.security.items).map(([key, measure]) => (
          <li key={key}>{measure}</li>
        ))}
      </ul>
    </Section>
  );
}

function ChangesSection({ texts }: SectionProps) {
  return (
    <Section number={9} heading={texts.changes.heading}>
      <p>{texts.changes.text}</p>
    </Section>
  );
}

/**
 * The privacy policy as published (docs/privacy-policy-draft.md, the part
 * from its title through section 9): the words from the shared locales, the
 * owner's values from `operator` (the server's environment) and `settings`
 * (`settings.ts`), a bold placeholder for each value not given yet.
 *
 * No hooks and no `react-i18next`: the page renders on the server
 * (CLAUDE.md), in the language its address names.
 */
export function PrivacyPolicy({ language, operator, settings }: PrivacyPolicyProps) {
  const texts = translations[language].privacy;
  const values = policyValues(language, operator, settings);

  return (
    <main
      lang={language}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6 break-words sm:px-6 sm:py-10"
    >
      <div className="flex flex-col gap-2">
        <OtherLanguages language={language} />
        <PageHeader
          title={texts.title}
          description={renderRich(texts.effective, { date: values.effectiveDate })}
        />
      </div>
      <p>{texts.intro}</p>
      <OperatorSection texts={texts} values={values} />
      <DataSection texts={texts} values={values} />
      <BasisSection texts={texts} values={values} />
      <RecipientsSection texts={texts} values={values} />
      <RetentionSection texts={texts} values={values} />
      <NotificationsSection texts={texts} values={values} />
      <RightsSection texts={texts} values={values} />
      <SecuritySection texts={texts} values={values} />
      <ChangesSection texts={texts} values={values} />
    </main>
  );
}
