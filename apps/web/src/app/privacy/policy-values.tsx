import { INTL_LOCALES, translations, type Language } from '@str-ops/shared';
import type { ReactNode } from 'react';

import { formatDay } from '@/lib/format-date';

import type { OperatorDetails } from './operator';
import { renderRich } from './rich-text';
import type { IsoDate, LocalizedText, PrivacySettings } from './settings';

export type PrivacyTexts = (typeof translations)[Language]['privacy'];

/** What a placeholder can ask for: every `privacy.fill` key but the two frames. */
type FillKey = Exclude<keyof PrivacyTexts['fill'], 'template' | 'statement'>;

/** Every value the policy's sentences take in, given or still a placeholder. */
export interface PolicyValues {
  readonly name: ReactNode;
  readonly id: ReactNode;
  readonly address: ReactNode;
  readonly email: ReactNode;
  readonly effectiveDate: ReactNode;
  readonly automaticDeletionDate: ReactNode;
  readonly signInBlockDate: ReactNode;
  readonly accountDeletedBy: ReactNode;
  readonly accountRetention: ReactNode;
  readonly vercelRegion: ReactNode;
  readonly sentryRegion: ReactNode;
  readonly serverLogRetention: ReactNode;
  readonly exportFormat: ReactNode;
  readonly processingAgreements: ReactNode;
  readonly transferBasis: ReactNode;
  readonly website: ReactNode;
}

export const LINK_CLASS = 'font-medium underline underline-offset-4 hover:text-muted-foreground';

/**
 * Bold and on a tint, so a page published too early shows its gaps at a
 * glance. No padding: beside a full stop it would read as a space.
 */
const PLACEHOLDER_CLASS = 'rounded-sm bg-muted font-bold text-foreground box-decoration-clone';

const SUPERVISORY_AUTHORITY_URL = 'https://www.uoou.cz';
const SUPERVISORY_AUTHORITY_LABEL = 'www.uoou.cz';

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <strong data-placeholder="" className={PLACEHOLDER_CLASS}>
      {children}
    </strong>
  );
}

/** «Months» in the reader's language, the plural form picked as i18next would. */
function monthsText(texts: PrivacyTexts, language: Language, count: number): ReactNode[] {
  const category = new Intl.PluralRules(INTL_LOCALES[language]).select(count);
  const forms: Readonly<Record<string, unknown>> = texts.retention;
  const form = forms[`months_${category}`];
  const template = typeof form === 'string' ? form : texts.retention.months_other;
  return renderRich(template, { count: String(count) });
}

/**
 * The page's values: what the owner gave, or a bold placeholder saying what
 * to write there. Nothing is made up in between.
 */
export function policyValues(
  language: Language,
  operator: OperatorDetails,
  settings: PrivacySettings,
): PolicyValues {
  const texts = translations[language].privacy;

  const fill = (what: FillKey): ReactNode => (
    <Placeholder>{renderRich(texts.fill.template, { what: texts.fill[what] })}</Placeholder>
  );
  const text = (value: string | null, what: FillKey): ReactNode => value ?? fill(what);
  const localized = (value: LocalizedText | null, what: FillKey): ReactNode =>
    value === null ? fill(what) : value[language];
  const day = (value: IsoDate | null, what: FillKey): ReactNode =>
    value === null ? fill(what) : formatDay(value, language);
  const statement = (isConfirmed: true | null, words: string): ReactNode =>
    isConfirmed === true ? (
      words
    ) : (
      <Placeholder>{renderRich(texts.fill.statement, { statement: words })}</Placeholder>
    );

  return {
    name: text(operator.name, 'operatorName'),
    id: text(operator.id, 'operatorId'),
    address: text(operator.address, 'operatorAddress'),
    email:
      operator.email === null ? (
        fill('contactEmail')
      ) : (
        <a href={`mailto:${operator.email}`} className={LINK_CLASS}>
          {operator.email}
        </a>
      ),
    effectiveDate: day(settings.effectiveDate, 'date'),
    automaticDeletionDate: day(settings.automaticDeletionDate, 'deadline'),
    signInBlockDate: day(settings.signInBlockDate, 'deadline'),
    accountDeletedBy: localized(settings.accountDeletedBy, 'accountDeletedBy'),
    accountRetention:
      settings.accountRetentionMonths === null
        ? fill('accountRetention')
        : renderRich(texts.retention.afterSwitchOff, {
            months: monthsText(texts, language, settings.accountRetentionMonths),
          }),
    vercelRegion: localized(settings.vercelRegion, 'vercelRegion'),
    sentryRegion: localized(settings.sentryRegion, 'sentryRegion'),
    serverLogRetention: localized(settings.serverLogRetention, 'serverLogRetention'),
    exportFormat: text(settings.exportFormat, 'exportFormat'),
    processingAgreements: statement(
      settings.processingAgreementsSigned,
      texts.recipients.agreements,
    ),
    transferBasis: statement(settings.transferBasisChecked, texts.recipients.transferBasis),
    website: (
      <a href={SUPERVISORY_AUTHORITY_URL} className={LINK_CLASS}>
        {SUPERVISORY_AUTHORITY_LABEL}
      </a>
    ),
  };
}
