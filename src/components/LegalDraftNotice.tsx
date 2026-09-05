// Every legal page carries this banner until counsel signs off — placeholder
// legal text should never look final or binding by accident. See
// docs/ARCHITECTURE.md §14: this build flags compliance items, it does not
// resolve them.
export function LegalDraftNotice() {
  return (
    <div className="mb-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <strong>Draft — pending legal review.</strong> This page is placeholder text for
      development purposes and has not been reviewed or approved by counsel. It is not
      currently binding and should not be relied upon until replaced with reviewed content.
    </div>
  );
}
