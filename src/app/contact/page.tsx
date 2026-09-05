import { PageShell } from '@/components/PageShell';
import { ContactForm } from '@/components/ContactForm';

export const metadata = { title: 'Contact — GrowEazzy' };

export default function ContactPage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Contact us</h1>
        <p className="mt-2 text-gray-600">
          Questions about a service, an existing order, or the affiliate programme — send us a
          message and our team will get back to you.
        </p>
        <div className="mt-8">
          <ContactForm />
        </div>
      </section>
    </PageShell>
  );
}
