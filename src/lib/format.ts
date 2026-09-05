// Money is stored as integer paise everywhere (docs/ARCHITECTURE.md §2).
// This is the one place that turns paise into a rupee display string — never
// format paise ad hoc in a component.
export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  }).format(rupees);
}
