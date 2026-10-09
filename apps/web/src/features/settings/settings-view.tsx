'use client';

import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { InPlaceLink } from '@/components/in-place-link';
import { PageHeader } from '@/components/page-header';
import { SignOut } from '@/components/sign-out';
import { ProcessSection } from '@/features/workflow/process-section';
import type { ThemeChoice } from '@/lib/theme';
import { useAddressState } from '@/lib/use-address-state';
import { cn } from '@/lib/utils';

import {
  readSettingsAddress,
  SETTINGS_SECTIONS,
  writeSettingsAddress,
  type SettingsSection,
} from './address';
import { HostToggles } from './host-toggles';
import { LanguageSwitcher } from './language-switcher';
import { ThemeSwitcher } from './theme-switcher';
import { VideoSettings } from './video-settings';

interface SettingsViewProps {
  email: string;
  /** The signed-in person: her profile keeps the panel's language. */
  userId: string;
  /** The theme this browser keeps (the cookie, read by the page). */
  theme: ThemeChoice;
  onSignOut: () => Promise<void>;
}

/** Each section's name: in the submenu and over the section itself. */
const SECTION_TITLE_KEY: Record<SettingsSection, string> = {
  account: 'panel.settings.account',
  appearance: 'panel.settings.appearance',
  company: 'panel.settings.company',
  process: 'panel.settings.workflow.title',
};

/** The address of a section, as its link carries it. */
function sectionHref(section: SettingsSection): string {
  const search = writeSettingsAddress({ section });
  return search === '' ? '/settings' : `/settings?${search}`;
}

/**
 * What a company decides once, in one place (5.4, variant A): a submenu of
 * sections and the open one beside it, every section the same width — no
 * longer four cards of three widths, the longest last.
 *
 * The account is this person's, the look this browser's, the switches and the
 * process the company's. The section open lives in the address, and a press
 * on another one is a step «Назад» walks back, as the tabs of the other pages
 * are (the owner's rule of 04.10).
 *
 * Every section stays mounted and only the open one is shown: the process
 * editor holds a draft until it is saved, and a look at «Компания» in the
 * middle of an edit must not throw it away.
 */
export function SettingsView({ email, userId, theme, onSignOut }: SettingsViewProps) {
  const { t } = useTranslation();
  const [address, setAddress] = useAddressState(readSettingsAddress, writeSettingsAddress);

  const open = (section: SettingsSection) => {
    if (section !== address.section) {
      setAddress({ section }, 'push');
    }
  };

  const sections: Record<SettingsSection, { description: string | null; body: ReactNode }> = {
    // The language is the person's (her profile), so it is the account's, not
    // the look of this one browser; the way out stays last.
    account: {
      description: t('panel.settings.signedInAs', { email }),
      body: (
        <>
          <LanguageSwitcher userId={userId} />
          <SignOut onSignOut={onSignOut} />
        </>
      ),
    },
    appearance: {
      description: t('panel.settings.appearanceHint'),
      body: <ThemeSwitcher initial={theme} />,
    },
    company: { description: t('panel.settings.companyHint'), body: <HostToggles /> },
    // «Процесс → Видео» (docs/tech-plan.md, 9): the company's video limits
    // after the steps they hold the video step to.
    process: {
      description: null,
      body: (
        <>
          <ProcessSection />
          <VideoSettings />
        </>
      ),
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.nav.settings')} />

      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <nav aria-label={t('panel.settings.sections')} className="lg:sticky lg:top-4">
          {/* On a phone the four sit in a row and wrap; from lg, a column. */}
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {SETTINGS_SECTIONS.map((section) => {
              const isCurrent = section === address.section;
              return (
                <li key={section}>
                  <InPlaceLink
                    href={sectionHref(section)}
                    isCurrent={isCurrent}
                    currentAs="page"
                    onOpen={() => open(section)}
                    className={cn(
                      'flex min-h-11 items-center rounded-md px-3 text-sm hover:bg-accent',
                      isCurrent && 'bg-accent font-medium',
                    )}
                  >
                    {t(SECTION_TITLE_KEY[section])}
                  </InPlaceLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsPanel
              key={section}
              title={t(SECTION_TITLE_KEY[section])}
              description={sections[section].description}
              isHidden={section !== address.section}
            >
              {sections[section].body}
            </SettingsPanel>
          ))}
        </div>
      </div>
    </div>
  );
}

interface SettingsPanelProps {
  title: string;
  /** Under the title, quieter: whose setting this is and how far it reaches. */
  description: string | null;
  /** Another section is open: this one stays mounted, out of sight and out of reach. */
  isHidden: boolean;
  children: ReactNode;
}

/**
 * One section, named by its h2 under the page's h1. No display class on the
 * section itself, so nothing outranks its `hidden`.
 */
function SettingsPanel({ title, description, isHidden, children }: SettingsPanelProps) {
  const headingId = useId();

  return (
    <section
      data-slot="settings-section"
      aria-labelledby={headingId}
      hidden={isHidden}
      className="w-full max-w-3xl rounded-lg border bg-card p-4 md:p-6"
    >
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h2 id={headingId} className="text-lg font-semibold">
            {title}
          </h2>
          {description === null ? null : (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </header>
        {children}
      </div>
    </section>
  );
}
