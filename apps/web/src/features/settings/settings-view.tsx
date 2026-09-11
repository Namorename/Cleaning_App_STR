'use client';

import { useTranslation } from 'react-i18next';

import { SignOut } from '@/components/sign-out';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ProcessSection } from '@/features/workflow/process-section';

import { HostToggles } from './host-toggles';

interface SettingsViewProps {
  email: string;
  onSignOut: () => Promise<void>;
}

/**
 * What a company decides once, in one place.
 *
 * Three cards, widest to narrowest in reach. The account is this person's
 * and nobody else's. The switches are the company's and change how every
 * cleaner's app behaves. The process is the company's too, with room for one
 * listing to differ — and it is the longest of the three, so it sits last
 * where it can be as tall as it needs to be.
 */
export function SettingsView({ email, onSignOut }: SettingsViewProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('panel.nav.settings')}</h1>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>{t('panel.settings.account')}</CardTitle>
          <CardDescription>{t('panel.settings.signedInAs', { email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignOut onSignOut={onSignOut} />
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
