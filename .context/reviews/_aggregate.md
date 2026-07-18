# Aggregate Review — Cycle 9/100

Date: 2026-07-18
Reviewed HEAD: `f50e96b31d04dae85cdd73eb2a99e816c8b403e7`

## Review coverage

The collaboration runtime exposed two concurrent child slots and no registered
specialist agent types. Both available children were launched together:

- `review_code_correctness`: code-reviewer, verifier, tracer, debugger
- `review_security_perf_arch`: security-reviewer, perf-reviewer, architect

The lead covered critic, test-engineer, document-specialist, and designer,
including the required live `agent-browser` interaction. This preserved all
eleven requested perspectives despite the runtime's four-thread total limit.
The provenance files are:

- `.context/reviews/cycle9-code-verifier-tracer-debugger.md`
- `.context/reviews/cycle9-security-performance-architecture.md`
- `.context/reviews/cycle9-critic-tests-docs-designer.md`

All reviewers inventoried the repository and current rules, traced cross-file
behavior, checked the complete Cycle 8 change surface against the surrounding
system, deduplicated historical/closed findings, and performed a final missed-
issues sweep. No child agent failed. An attempted third child allocation was
rejected by the thread limit before creation; the lead completed those roles
locally, so this is a capacity constraint rather than an agent failure.

## Executive result

Three unique current findings survived evidence review:

1. **COR-C9-01 (Medium/High, confirmed):** detached gallery-config cache
   invalidation is vulnerable to a late pre-invalidation promise republishing
   stale settings and clearing a newer in-flight owner.
2. **COR-C9-02 (Medium/High, confirmed):** public grid source sets truncate the
   configurable derivative ladder by array position, forcing valid custom
   configurations and high-DPR one-item grids to upscale smaller files while
   adequate generated derivatives are omitted.
3. **ARCH-C9-01 / DOC-C9-01 (Low/High, confirmed, deduplicated):** the active
   Cycle 8 plan still reports signed publication and deployment as pending even
   though the three commits are GPG-good, `master == origin/master`, the prior
   cycle reported deployment success, and the live site exposes the shipped
   source policy.

No new security, authorization, privacy, dependency, database-schema,
performance-budget, WCAG, information-architecture, or test-flakiness finding
survived validation. Existing carry-forward risks remain governed by
`.context/plans/deferred-carry-forward.md`; only deferred item `C6-24` has an
exit criterion newly fired, and its concrete production race is promoted into
scheduled finding COR-C9-01 rather than left deferred.

## Deduplicated findings

### COR-C9-01 — Late detached-config reads can undo post-commit invalidation

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed correctness defect; must be scheduled**
- Regions: `apps/web/src/lib/gallery-config.ts:234-269`, invalidation caller
  `apps/web/src/app/actions/settings.ts:235-267`, detached consumers in
  `apps/web/src/lib/image-queue.ts:542-549,862-881,981-1008`, incomplete tests
  `apps/web/src/__tests__/gallery-config-uncached-microcache.test.ts:76-94,129-141`.
- Evidence: `getGalleryConfigDetached()` unconditionally publishes the result
  of the promise that was current when a read began. Invalidation clears the
  two module variables but cannot cancel that promise. If read A starts, a
  settings transaction commits and invalidates, and read B starts, A may still
  cache its stale value for two seconds; A's unconditional `finally` may also
  clear B's ownership slot.
- Concrete failure: an admin successfully disables stub semantic search while
  a detached read is in flight, but a just-processed image still observes the
  republished `stub` value and writes a stub embedding after the mutation
  returned success. Legacy jobs without a persisted processing snapshot can
  similarly observe old encode/caption settings.
- Required fix: introduce an invalidation generation and promise-identity
  ownership. A read may publish only when its captured generation is current,
  and may clear the slot only if the slot still owns that same promise. Add a
  controlled A/invalidate/B/A-resolves-first regression test.
- Historical disposition: this concrete race fires deferred `C6-24`'s exit
  criterion. It is no longer deferred.

### COR-C9-02 — Public grid srcsets discard valid configured derivatives

- Severity: **Medium**
- Confidence: **High**
- Status: **Confirmed correctness/perceived-quality defect; must be scheduled**
- Regions: configuration contract
  `apps/web/src/lib/gallery-config-shared.ts:152-177,255-301`; main grid
  `apps/web/src/components/masonry-card.tsx:87-115`; timeline
  `apps/web/src/app/[locale]/(public)/timeline/page.tsx:98-100,230-276`; year
  `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:104-111,192-238`;
  shared groups `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:124-127,198-242`.
- Evidence: the supported setting accepts one to eight sorted widths from 128
  through 10,000 px, but main/shared use only `imageSizes[0]` and `[1]`;
  timeline/year use a 640-nearest first value and positional `[1]` second value.
  The remaining generated derivatives never enter any public grid `srcset`.
- Concrete failure: valid `128,256,640,1536` output produces all four files,
  yet a 490 px DPR-1 main-grid slot can see only 128w/256w and upscales the 256w
  file. With defaults, a one-item 1,504 px grid at DPR 2 cannot choose the
  existing 2048w/4096w variants because only 640w/1536w are advertised.
- Required fix: centralize monotonic source-set generation from the complete
  normalized configured width list and reuse it across main, timeline, year,
  and shared grids. Add deterministic unit/source-contract coverage for custom
  `128,256,640,1536`, one/two-size lists, and high-DPR large slots; add browser
  coverage for actual custom candidate selection if feasible in the disposable
  fixture.
- Historical disposition: this is not the closed hardcoded/unsorted settings
  finding. Configuration is correctly normalized and propagated; the remaining
  live bug is positional truncation at render consumers.

### ARCH-C9-01 / DOC-C9-01 — Cycle 8 release ledger is stale

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed documentation/workflow defect; two-reviewer agreement**
- Regions: `.context/plans/cycle-8-2026-07-18-plan.md:5,63-65,99-100`, index
  `.context/plans/README.md:33-43,51-57`.
- Evidence: the plan says “signed release pending” and leaves signed push and
  deploy unchecked. `git verify-commit` reports good signatures for
  `b3e299f1`, `d2a90c3c`, and `f50e96b3`; local and remote master both resolve
  to `f50e96b3`; Cycle 8 reported `per-cycle-success`; and the deployed public
  site selects `_640.avif` for live 288 px ultrawide cards under the new policy.
- Concrete failure: a recovery agent trusts the canonical plan frontier and
  repeats already-completed terminal work or reports the release as unpublished.
- Required fix: reconcile Cycle 8's status/checklist/evidence, archive it, and
  advance the plan index. Record live behavioral evidence without inventing an
  exact deployed SHA.

## Cross-agent agreement and adjudication

- The stale Cycle 8 release ledger was independently identified by the
  security/performance/architecture child and the local document/critic pass;
  those two reports are one deduplicated finding at the highest shared
  severity/confidence (Low/High).
- The code/correctness child supplied both Medium findings. The lead re-traced
  the promise ownership and every main/archive/shared source-set construction;
  both failure scenarios follow deterministically from current source and the
  accepted settings contract.
- The security/performance reviewer found no new vulnerability or independent
  resource regression. COR-C9-02 nevertheless has a user-visible bandwidth/
  sharpness consequence; its primary classification stays correctness because
  valid generated outputs are unreachable from the browser source set.
- The Cycle 8 container-cap arithmetic itself is sound. The new source-set
  finding is an orthogonal candidate-ladder defect that the default 640/1536-
  leading fixtures did not exercise.

## Validation evidence from Prompt 1

- ESLint passed.
- API-auth, action-origin/mutation-barrier, and public-route-rate-limit lints
  passed.
- App and script typechecks passed.
- Production dependency audit passed with zero vulnerabilities.
- Focused Vitest passes: 42 correctness/queue/restore/responsive tests and 405
  security/auth/privacy/migration/responsive tests.
- Migration/journal inventory is 31/31.
- `git diff --check` passed before aggregate creation.
- Live public browser review covered 2560x1440/DPR 2 and 375x812 layouts,
  accessibility structure, load-more, search-dialog focus/escape restoration,
  theme/media state, error/console output, screenshots, accessibility diffs,
  and source selection. Local live admin review was infeasible because the
  disposable MySQL endpoint was down; that limitation does not affect the two
  source-proven defects.

These are review baselines, not substitutes for Prompt 3's required complete
quality-gate run.

## Deferred/revalidated items

No new finding is deferred. Security, correctness, and data-loss findings are
not deferrable under the cycle rules, so COR-C9-01 and COR-C9-02 must be
implemented. ARCH-C9-01 is also scheduled because its fix is required by the
plan-archival prompt. Existing carry-forward items retain their original
severity, confidence, reasons, policy constraints, and exit criteria in
`.context/plans/deferred-carry-forward.md`; none is silently copied or
reclassified here. `C6-24` must be marked promoted/closed when COR-C9-01 lands.

## Agent failures

None. Both created child agents returned and persisted their reviews. The
runtime rejected a third child allocation because all four total threads were
already occupied; the lead completed those requested roles directly.
