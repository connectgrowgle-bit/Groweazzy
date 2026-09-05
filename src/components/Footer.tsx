import Link from 'next/link';

const FOOTER_LINKS = [
  { href: '/services', label: 'Services' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/affiliate', label: 'Affiliate Programme' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Refund Policy' },
];

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-gray-500">
          {FOOTER_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-gray-800">
              {link.label}
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-gray-400">
          © {new Date().getFullYear()} GrowEazzy. All amounts shown in INR.
        </p>
      </div>
    </footer>
  );
}
