import { PageShell } from '@/components/PageShell';
import { getFaqs } from '@/lib/repository';

export const metadata = { title: 'FAQ — GrowEazzy' };

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  services: 'Services',
  affiliate: 'Affiliate Programme',
  billing: 'Billing',
};

export default async function FaqPage() {
  const faqs = await getFaqs();
  const byCategory = faqs.reduce<Record<string, typeof faqs>>((acc, faq) => {
    (acc[faq.category] ??= []).push(faq);
    return acc;
  }, {});

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Frequently asked questions</h1>

        <div className="mt-10 space-y-10">
          {Object.entries(byCategory).map(([category, items]) => (
            <div key={category}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                {CATEGORY_LABELS[category] ?? category}
              </h2>
              <div className="mt-3 divide-y divide-gray-200 rounded-lg border border-gray-200">
                {items.map((faq) => (
                  <details key={faq.id} className="group p-4">
                    <summary className="cursor-pointer list-none font-medium text-gray-900 marker:content-none">
                      <span className="flex items-center justify-between">
                        {faq.question}
                        <span className="text-gray-400 group-open:rotate-45">+</span>
                      </span>
                    </summary>
                    <p className="mt-2 text-sm text-gray-600">{faq.answer}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
