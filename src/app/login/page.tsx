import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { LoginForm } from '@/components/LoginForm';

export const metadata = { title: 'Log in — GrowEazzy' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;

  return (
    <PageShell>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Log in</h1>
        <LoginForm next={next} />
        <p className="mt-6 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-brand hover:underline">
            Register
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
