'use client';

import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { SignOut } from '@/components/sign-out';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProcessSection } from '@/features/workflow/process-section';
import type { ThemeChoice } from '@/lib/theme';

import { HostToggles } from './host-toggles';
import { ThemeSwitcher } from './theme-switcher';

interface SettingsViewProps {
  email: string;
  /** The theme this browser keeps (the cookie, read by the page). */
  theme: ThemeChoice;
  onSignOut: () => Promise<void>;
}

/**
 * What a company decides once, in one place.
 *
 * Four cards, narrowest to widest in reach. The account is this person's
 * and nobody else's, the look this browser's. The switches are the company's
 * and change how every cleaner's app behaves. The process is the company's
 * too, with room for one listing to differ — and it is the longest of them,
 * so it sits last where it can be as tall as it needs to be.
 */
export function SettingsView({ email, theme, onSignOut }: SettingsViewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('panel.nav.settings')} />

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t('panel.settings.account')}</CardTitle>
          <CardDescription>{t('panel.settings.signedInAs', { email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignOut onSignOut={onSignOut} />
        </CardContent>
      </Card>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t('panel.settings.appearance')}</CardTitle>
          <CardDescription>{t('panel.settings.appearanceHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSwitcher initial={theme} />
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('panel.settings.company')}</CardTitle>
          <CardDescription>{t('panel.settings.companyHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <HostToggles />
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{t('panel.settings.workflow.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ProcessSection />
        </CardContent>
      </Card>
    </div>
  );
}
