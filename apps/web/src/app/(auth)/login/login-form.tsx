'use client';

import { useActionState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { signIn, type SignInState } from './actions';

const INITIAL: SignInState = { issue: null };

interface LoginFormProps {
  next: string;
}

export function LoginForm({ next }: LoginFormProps) {
  const { t } = useTranslation();
  const [state, action, isPending] = useActionState(signIn, INITIAL);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('panel.title')}</CardTitle>
        <CardDescription>{t('panel.login.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t('panel.login.email')}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('panel.login.password')}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {state.issue !== null ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`panel.login.issues.${state.issue}`)}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {t('panel.login.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
