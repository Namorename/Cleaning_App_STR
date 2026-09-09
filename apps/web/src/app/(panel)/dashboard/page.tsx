'use client';

import { useTranslation } from 'react-i18next';

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Stage 0: the shell works. KPI tiles arrive with stage 8. */
export default function DashboardPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('panel.nav.dashboard')}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t('panel.dashboard.emptyTitle')}</CardTitle>
          <CardDescription>{t('panel.dashboard.emptyHint')}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
