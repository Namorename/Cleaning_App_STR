import { LoginForm } from './login-form';
import { LoginLanguage } from './login-language';

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

/**
 * Server shell only: the words are the form's, in the language of the `lang`
 * cookie — English for a guest who chose none (`lib/language.ts`). Under the
 * card, the three languages to choose from; outside the form, so a choice
 * never sends it.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <LoginForm next={next ?? '/dashboard'} />
        <LoginLanguage />
      </div>
    </main>
  );
}
