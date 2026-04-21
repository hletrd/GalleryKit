# Cycle 9 Architect Review (manual fallback after stalled lane)

## Inventory
- Reviewed the clipboard/share-link boundary, public-search data contract, and storage-abstraction documentation boundary.
- Focused on places where the operator-visible contract diverged from the canonical server truth.

## Confirmed issues

### A9-01 — Search is keyed to implementation slugs instead of the canonical topic vocabulary shown to users
- **Severity:** MEDIUM
- **Confidence:** Medium
- **Citations:** `apps/web/src/lib/data.ts:650-726`, `apps/web/src/components/search.tsx:232-236`
- **Concrete failure scenario:** a user searches by the visible topic label/alias, but the system only matches lower-level slug fields, so relevant photos disappear from the search UX.
- **Suggested fix:** align the search contract with canonical topic labels and aliases.

### A9-02 — Storage abstraction comments still overstate a backend-switching architecture that the live pipeline does not use
- **Severity:** LOW
- **Confidence:** High
- **Citations:** `apps/web/src/lib/storage/index.ts:1-18`, `apps/web/src/lib/storage/types.ts:1-12`
- **Concrete failure scenario:** maintainers infer a supported end-to-end S3/MinIO switch path that the running upload/serve flow does not actually honor.
- **Suggested fix:** narrow the comments to the current experimental scope.
