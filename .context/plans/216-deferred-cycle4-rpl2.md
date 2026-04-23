# Deferred findings — Cycle 4 RPL loop 2 (2026-04-23)

**Source:** `.context/reviews/_aggregate-cycle4-rpl2.md`

**Deferral rule policy:**

- Every finding is either (a) scheduled in `plan-215-cycle4-rpl2-fixes.md` or (b) recorded here.
- Each deferred item records: file+line citation, original severity/confidence, concrete reason for deferral, exit criterion.
- No severity downgrade; no silent drops.
- Security/correctness/data-loss findings are not deferrable unless repo rules allow — confirmed none of the items below qualify.
- Deferred work, when later picked up, still obeys repo rules: GPG-signed fine-grained commits, conventional commit + gitmoji, no `--no-verify`, Node 24+, TypeScript 6+, etc.

## Deferred items

### AGG4R2-04 — `updateTopic` string-sentinel errors (refactor)

- **File:** `apps/web/src/app/actions/topics.ts:213, 225`
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Reason to defer:** refactor touching all throw sites and catch sites across `topics.ts` (and potentially `admin-users.ts`, `db-actions.ts`). Not a correctness bug; current pattern is covered by tests. Separate PR is more reviewable than mixing with the polish patch in plan 215.
- **Exit criterion:** a follow-up refactor PR introduces a `class <Name>Error extends Error` pattern for the 5+ sentinel-string throws currently in the repo, plus updates to catch sites + tests. Size budget: 1–2 files per class.

### AGG4R2-06 — `stripControlChars` + reject-if-changed idiom copy-paste

- **Files:** 14+ call sites across `apps/web/src/app/actions/**`
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Reason to defer:** Pure refactor. Extracting a `requireCleanInput(raw, invalidMsg)` helper would touch every server action and requires careful unit-test migration. Not a correctness bug — current pattern is verified per-action.
- **Exit criterion:** follow-up PR introducing `requireCleanInput` in `lib/sanitize.ts` + callsite migration + tests.

### AGG4R2-08 — `flushGroupViewCounts` N-statement UPDATE batch (perf)

- **File:** `apps/web/src/lib/data.ts:48-96`
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Reason to defer:** This is a perf item gated by benchmarking. Current pool of 10 connections + chunk size 20 means the practical cost is small. Changing to `ON DUPLICATE KEY UPDATE` with multi-VALUES would require careful analysis of `sharedGroups.view_count` + `view_count` update semantics. Benchmark first.
- **Exit criterion:** benchmark showing current flush takes >50ms on real loads OR a future cycle where `shared_groups` traffic grows substantially; then rewrite as single UPSERT.

### AGG4R2-09 — `<JsonLdScript>` shared component (refactor)

- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`
- **Severity:** LOW
- **Confidence:** LOW
- **Reason to defer:** Pure refactor. Current inline usage is safe after C4R-RPL2-02 lands (safeJsonLd hardened). Extracting a component is cosmetic DX improvement.
- **Exit criterion:** separate refactor PR that ships `apps/web/src/components/json-ld-script.tsx` and migrates all three callsites.

### AGG4R2-10 — `deleteImageVariants` comment cleanup (cosmetic)

- **File:** `apps/web/src/lib/process-image.ts:170-204`
- **Severity:** LOW
- **Confidence:** LOW
- **Reason to defer:** Pure comment cleanup. No code change.
- **Exit criterion:** next cycle that touches `process-image.ts` for any reason includes a comment-tightening pass.

### AGG4R2-11 — `data.ts` module split (refactor)

- **File:** `apps/web/src/lib/data.ts` (894 lines)
- **Severity:** LOW
- **Confidence:** LOW
- **Reason to defer:** Refactor. Splitting into `data/queries.ts`, `data/view-count.ts`, `data/seo.ts` requires import-path migrations throughout the app. Not a correctness bug.
- **Exit criterion:** separate refactor PR. Size budget: one PR per split (to keep blast radius small).

### AGG4R2-12 — Playwright JSON-LD coverage (test expansion)

- **File:** `apps/web/e2e/public.spec.ts`
- **Severity:** LOW
- **Confidence:** LOW
- **Reason to defer:** Test-surface expansion, not a bug fix. Playwright run takes ~2 min already; each new assertion adds cost. Batch with other E2E expansions in a dedicated test-coverage PR.
- **Exit criterion:** dedicated test-coverage plan that bundles this with D6-14 (broader test-surface expansion) and related carry-forwards.

## Carry-forward (unchanged)

All prior-cycle deferreds remain deferred with no change in status. See the "Carry-forward" section of `_aggregate-cycle4-rpl2.md` for the full list.

## Repo-rule conformance confirmation

Every deferral above is a refactor, perf tuning gated by data, or test-surface expansion. No security, correctness, or data-loss finding is being deferred. Repo-rule exceptions required: **none**.

When these items are eventually picked up, they remain bound by:
- GPG-signed commits (`-S` flag)
- Conventional commit + gitmoji format
- No `--no-verify` unless repo rules explicitly authorize
- Node 24+ LTS, TypeScript 6+, Rust 2024 edition (if any Rust added), Python >= 3.14 (if any Python added)
- Latest stable framework versions (Next.js 16+, React 19+, etc.)
