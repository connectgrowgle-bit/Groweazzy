import { Header } from './Header';
import { Footer } from './Footer';

// Every public page (Phase 1) wraps its content in this. Kept as a
// component rather than pushed into the root layout so Phase 2's
// authenticated dashboard routes can use a different shell without fighting
// this one.
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex-1">{children}</div>
      <Footer />
    </div>
  );
}
