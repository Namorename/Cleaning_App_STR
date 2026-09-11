'use client';

import { useTranslation } from 'react-i18next';

import { SignOut } from '@/components/sign-out';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SettingsViewProps {
  email: string;
  onSignOut: () => Promise<void>;
}

/**
 * Settings, as far as they go for now.
 *
 * Stage 6 fills this screen with the process builder and the company's
 * switches. What is here today is the account: who is signed in, and the way
 * out — which had to leave the sidebar, where it sat one press away from the
 * navigation.
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

      <p className="text-sm text-muted-foreground">{t('panel.settings.rest')}</p>
    </div>
  );
}
