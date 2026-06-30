# Cycle 36/100 Deferred Findings

Date: 2026-06-30 KST
Source review: `.context/reviews/cycle-36-2026-06-30/_aggregate.md`
Reviewed HEAD: `bdfb38a1c39bd828c07851d3d096602441b4122c`

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, and current repository plan/review history. No `.cursorrules`, `CONTRIBUTING.md`, or `docs/` style/policy files exist in this checkout.

Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, required quality gates, and per-cycle deploy policy.

## New Cycle 36 Deferred Items

### PERF-C36-01 - Bootstrap orphan-temp cleanup repeats on every queue continuation

- Original severity/confidence: Medium / High
- File+line citation: `apps/web/src/lib/image-queue.ts:80`, `apps/web/src/lib/image-queue.ts:885`, `apps/web/src/lib/image-queue.ts:925`, `apps/web/src/lib/image-queue.ts:1007`, `apps/web/src/lib/image-queue.ts:1013`, `apps/web/src/lib/process-topic-image.ts:135`
- Reason for deferral: Performance optimization that does not alter correctness, security, data integrity, or current deploy safety. This cycle is reserved for high-confidence security-gate and schema-auth boundary fixes.
- Exit criterion: Re-open when startup/backfill traces show orphan cleanup overlapping queue continuation on production-sized backlogs, or when image-queue startup work is otherwise being touched.

### PERF-C36-02 - Per-photo OG generation cannot 304 unchanged revalidations

- Original severity/confidence: Medium / High
- File+line citation: `apps/web/src/app/api/og/photo/[id]/route.tsx:58`, `apps/web/src/app/api/og/photo/[id]/route.tsx:118`, `apps/web/src/app/api/og/photo/[id]/route.tsx:134`, `apps/web/src/app/api/og/photo/[id]/route.tsx:223`, `apps/web/src/app/api/og/route.tsx:118`
- Reason for deferral: Performance/cache optimization with non-trivial input-hash design. Existing route has rate limiting and bounded fetch/render budgets, so it is not a correctness or security blocker this cycle.
- Exit criterion: Re-open when OG route performance is scheduled, crawler revalidation load is observed, or an adjacent OG metadata/cache change is in progress.

### PERF-C36-03 - CLIP image preprocessing ignores the tunable input-pixel cap

- Original severity/confidence: Low / Medium
- File+line citation: `apps/web/src/lib/process-image.ts:352`, `apps/web/src/lib/process-image.ts:922`, `apps/web/src/lib/clip-model.ts:273`, `apps/web/src/lib/clip-model.ts:290`, `apps/web/scripts/backfill-clip-embeddings.ts:185`
- Reason for deferral: Low-severity deployment tuning mismatch. Sharp still applies its own default pixel guard, and semantic production remains operator-gated.
- Exit criterion: Re-open when CLIP production/backfill work is scheduled, when operators lower `IMAGE_MAX_INPUT_PIXELS`, or when a large legacy-original CLIP decode incident is observed.

### C36-DES-01 - Pagination errors are not announced by the component status region

- Original severity/confidence: Medium / High
- File+line citation: `apps/web/src/components/load-more.tsx:49`, `apps/web/src/components/load-more.tsx:61`, `apps/web/src/components/load-more.tsx:72`, `apps/web/src/components/load-more.tsx:81`, `apps/web/src/components/load-more.tsx:165`
- Reason for deferral: Accessibility/UX improvement with clear localized implementation path, but not a security/correctness/data-loss blocker. This cycle is already carrying multiple security-gate fixes.
- Exit criterion: Re-open in the next UI/accessibility cycle, or immediately if load-more error handling is touched.

### C36-DES-02 - Public semantic-search setup errors expose operator jargon

- Original severity/confidence: Medium / High
- File+line citation: `apps/web/src/components/search.tsx:199`, `apps/web/messages/en.json:426`, `apps/web/messages/ko.json:426`
- Reason for deferral: Public-copy/product polish issue. The semantic route fails safely and the feature is operator-gated; copy changes should be bundled with semantic-search UX work.
- Exit criterion: Re-open when semantic-search setup/fallback UX is scheduled or before enabling production semantic search for public visitors.

### C36-DES-03 - Upload rejection toasts can bypass localization

- Original severity/confidence: Low / High
- File+line citation: `apps/web/src/components/upload-dropzone.tsx:205`, `apps/web/src/components/upload-dropzone.tsx:217`, `apps/web/messages/en.json:550`, `apps/web/messages/ko.json:550`
- Reason for deferral: Low-severity i18n polish. It does not affect upload validation, storage safety, or admin data integrity.
- Exit criterion: Re-open when upload-dropzone UX/i18n is touched or when adding upload rejection message tests.

## Carry-Forward Note

Cycle 33 deferred findings remain recorded in `.context/plans/cycle-33-2026-06-30-deferred.md` with original severity/confidence, reason, and exit criterion. This cycle did not re-open those items because no fresh evidence changed their severity or made them scheduled now.
