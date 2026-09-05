import { getServices } from '@/lib/repository';

// Placeholder home page — Phase 1 replaces this with the real 15-page public
// site. Reads through the repository seam (docs/ARCHITECTURE.md §3) even
// here, so this line survives unchanged once Phase 9 backs it with the DB.
export default async function HomePage() {
  const services = await getServices();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-brand">GrowEazzy</h1>
      <p className="mt-2 text-gray-600">Phase 0 scaffold — public site lands in Phase 1.</p>
      <ul className="mt-8 space-y-2">
        {services.map((service) => (
          <li key={service.id} className="rounded border border-gray-200 p-4">
            <div className="font-medium">{service.name}</div>
            <div className="text-sm text-gray-500">{service.shortDescription}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
