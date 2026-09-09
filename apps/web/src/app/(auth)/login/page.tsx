import { LoginForm } from './login-form';

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

/** Server shell only: the words are the form's, rendered in the manager's language. */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <LoginForm next={next ?? '/dashboard'} />
    </main>
  );
}
