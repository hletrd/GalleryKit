# Cycle 10b Architecture Review

Role: architect. Scope: whole-repo module/dependency inventory, shared-state coordination
hazards under the documented single-writer topology, advisory-lock scope correctness,
migration/schema-drift runbook soundness, layering violations (client-safe vs server-only,
force-bundling), ETag/cache-invalidation correctness, `instrumentation.ts` startup ordering,
maintenance-scheduler lifecycle, boundary honesty (reserved-but-unwired modules).

Reviewed COMMITTED HEAD only: `f4faad29f1b90984e352677c66d832239787b855` (`docs(review):
add cycle 29 architecture review`). Read via `git show HEAD:<path>`-equivalent (working tree
matched HEAD for every file cited below except the five files the peer has dirty —
`check-action-origin.ts`, `check-action-origin.test.ts`, `cycle-28-source-contracts.test.ts`,
`.context/plans/README.md`, `.context/plans/deferred-carry-forward.md` — none of which this
review cites). No source changes made.

## Method

Read `CLAUDE.md` in full (architecture/security/pipeline documentation). Cross-checked every
candidate finding against `.context/plans/deferred-carry-forward.md` (open carry-forward
register through run-10 cycle 24), `.context/plans/cycle-9b-2026-07-08-deferred.md` (this
loop's own immediately-prior cycle), `.context/reviews/run10-cycle29/_aggregate.md` (peer's
latest), and this loop's `cycle-1` through `cycle-9` `architect.md` reports, to avoid re-filing
tracked items. Verified that `cycle-9b`'s three findings (`ARCH9-01/02/03`) were actually
closed at HEAD, not just planned:

- **ARCH9-03** (mutation-barrier scanner gap) — CLOSED. `check-action-origin.ts:292,1641`
  now requires `acquireAdminMutationSlot` on every mutating action export (or an
  `@mutation-barrier-exempt` comment), mirroring the same-origin scanner.
- **ARCH9-02** (`pending-session-revocations.ts` missing the `globalThis + Symbol.for` guard) —
  CLOSED. `src/lib/pending-session-revocations.ts:27-39` now carries the same pattern as its
  six siblings.
- **ARCH9-01** (`ActionResult<T>` dead shared contract) — CLOSED via deletion:
  `apps/web/src/lib/action-result.ts` no longer exists (`grep -rln "ActionResult" src`
  returns nothing); the 13 action modules keep their independently-evolved shapes, which is
  the "adopt-or-delete" call the finding asked for.

Read in full or in relevant part for this cycle: `src/instrumentation.ts`,
`src/lib/maintenance-scheduler.ts`, `src/lib/advisory-locks.ts`, `src/lib/restore-maintenance.ts`,
`src/lib/restore-maintenance-durable.ts`, `src/lib/serve-upload.ts` (385 lines), both
`uploads/[...path]/route.ts` twins (diffed — functionally identical), `next.config.ts` headers
block, `src/__tests__/client-server-only-boundary.test.ts` (589 lines, in full), and grepped
every `GET_LOCK`/`RELEASE_LOCK` call site across `src` and `scripts` to confirm all route
through the centralized `advisory-locks.ts` constants (they do — `topics.ts`, `admin-users.ts`,
`settings.ts`, `embeddings.ts`, `upload-processing-contract-lock.ts`, `db-actions.ts`,
`backfill-color-pipeline.ts`, `backfill-clip-embeddings.ts` all import the named constants;
none reintroduce an inline string literal).

**Explicitly excluded (already tracked, verified unchanged or accepted, do not re-report):**
the image-queue.ts/process-image.ts "god object" trend (C4-16, still assess-only, no new
concrete symptom found this cycle); `lib/storage/*` zero-consumer abstraction (C2-27); the
shared-group view-count buffer's process-local placement inside `data.ts` (AGG-C10-13);
`data-timeline.ts` manually mirroring `data.ts`'s select-field shape (flagged since cycle-1);
the two `uploads/[...path]` route twins needing hand-sync (C7-ARCH note — diffed this cycle,
currently in sync); `hdr-filenames.ts` reserved-but-unwired status (verified: zero non-test
call sites beyond the module itself, matches the documented WI-09 gate, no drift); the
`content-security-policy.ts` triple-consumer bundling risk (C7-ARCH2/3, unchanged); the
single-writer-guard self-healing re-acquire loop and DB-scoped lock naming (C3-03/C4-06,
verified present and unchanged in `advisory-locks.ts:51-72` and referenced by
`single-writer-guard.ts`); the `instrumentation.ts` shutdown-drain ordering and `SIGTERM`/
`SIGINT` handled-state guard (C4-A3/A4, read in full, correct and unchanged).

## Findings

### ARCH10b-01 — The client→server-only boundary test's import-closure walker only follows `@/lib`/`@/db` edges, silently blind to leaks routed through an intermediate `@/components/*` (or any other non-`@/lib`/`@/db`) module

**Severity:** Medium · **Confidence:** High · **Status:** New, structural gap (no live violation today)

**Citations:**
- `apps/web/src/__tests__/client-server-only-boundary.test.ts:142` — the walker's entire
  edge-following predicate: `const isAliased = (spec: string): boolean => spec.startsWith('@/lib') || spec.startsWith('@/db');`.
  `extractAliasedImports` (lines 138-223) only ever returns specifiers matching this
  predicate; `findServerOnlyInClosure` (lines 334-359) only pushes resolved modules for
  specifiers this function returns. A `'use client'` entry file's import of
  `@/components/anything` is never extracted, so that file is **never visited** by the DFS,
  regardless of what it itself imports.
- The module's own docstring (lines 1-14) states the intended contract as "no `'use client'`
  module transitively imports a server-only file" — unqualified. The actual enforced contract
  is narrower: "no `'use client'` module transitively imports a server-only file **via a
  `@/lib`/`@/db`-prefixed import chain**." Every widening this test has received over its
  history (`AGG-C5-01` mysql2-driver-as-signal, `AGG-C6-02` dynamic-import/require-equals,
  `AGG-C10-FIX` native-module allowlist, `A14-01` argon2, `A15-01` next/headers+next/cache+
  next-intl/server) extended *which modules count as server-only-equivalent*, never *which
  edges get walked* — so this gap has persisted through every one of those hardening passes.
- **Concrete near-miss pattern already present in the codebase**, proving this is not a
  hypothetical shape: `apps/web/src/components/nav.tsx:2` (`import { buildSeoSettingsFallback,
  getSeoSettings, getTopicsCached } from "@/lib/data"`, a value import reaching `@/db` →
  `mysql2`) and `apps/web/src/components/on-this-day-widget.tsx:3` (`import {
  getOnThisDayImages } from '@/lib/data-timeline'`, and `data-timeline.ts:11` itself
  `import { db, images, imageTags, tags } from '@/db'`) are both plain Server Components
  living in `components/` — no `'use client'` directive — that directly call the DB-backed
  data layer. Today they are imported only from Server Component entry points
  (`src/app/[locale]/(public)/layout.tsx:1` and `src/app/[locale]/not-found.tsx:3` for `Nav`;
  `src/app/[locale]/(public)/page.tsx:3` for `OnThisDayWidget`), confirmed by inspection — so
  there is **no live violation today**. But nothing stops a future `'use client'` file from
  importing `@/components/nav` or `@/components/on-this-day-widget` directly (e.g. to reuse a
  small helper, or because a contributor converts one of them to interactive and adds
  `'use client'` at the top without noticing the file still does direct data access) — and if
  that happens, `findServerOnlyInClosure` will never even queue `nav.tsx`/
  `on-this-day-widget.tsx` for inspection, because the edge from the client entry file to
  `@/components/nav` is never extracted in the first place.
- No compensating guard exists at a different layer: `eslint.config.mjs` (checked in full)
  only loads `eslint-config-next`'s two shared configs plus one unused-vars rule override —
  no `eslint-plugin-boundaries`/`import/no-restricted-paths`-style rule, confirming the
  cycle-7 architect review's prior "no boundary ESLint rule configured" observation still
  holds today.

**Why this is a real problem:** the whole point of this test (per its own history of
increasingly specific patches) is to convert an "opaque webpack build failure" class of bug
into a "fast, readable vitest failure with the exact import chain." A leak that routes through
`@/components/*` instead of directly through `@/lib`/`@/db` regresses to exactly the failure
mode this test was built to eliminate — a `next build` that either fails with an opaque
native-binding/Node-builtin resolution error, or (worse, per the test's own `AGG-C5-01`
docstring reasoning about the pre-widening state) silently bundles `mysql2` client code that
only crashes at runtime when the code path executes in a browser.

**Concrete future-failure scenario:** a contributor adds a mobile hamburger-menu client
component and, to avoid prop-drilling the topic list, imports `@/components/nav` directly for
a helper it exports, or lifts `Nav`'s JSX into a `'use client'` wrapper for a scroll-hide
behavior. `nav.tsx` still directly imports `getSeoSettings`/`getTopicsCached` from
`@/lib/data`. `npm test` (including this exact boundary test) passes green because the walker
never traverses the `@/components/nav` edge from the new client entry. The regression surfaces
only in `npm run build` (or worse, only in production if the dev server's more permissive
module resolution masks it), as an opaque `mysql2`/`net`/`tls` bundling error with no chain
information — precisely the debugging experience `AGG-R5C3-21` was created to prevent.

**Suggested fix:** widen `isAliased` (or add a parallel predicate) to also follow
`@/components` (and, if any cross-imports exist, `@/app`) edges during the closure walk, not
just when computing whether a resolved module itself "reaches server-only." The existing
`resolveAliasedModule` / `reachesServerOnly` / cache infrastructure needs no change — only the
edge-extraction predicate that decides which specifiers get pushed onto the DFS stack. Given
the walker already exists and is exercised on every test run, the marginal cost is a one-line
predicate widening plus a regression pin (e.g., a synthetic fixture proving a
`'use client'` file that imports `@/components/nav` fails red) — much cheaper than the
opaque-build-failure cost it would otherwise defer to.

**Trade-off of widening:** naively following every `@/components/*` edge risks false
positives if a client component imports a *type* from a component that itself has an
unrelated value chain reaching server-only code paths gated behind runtime branches (e.g. an
admin-only server action re-exported alongside client-safe utilities in the same file) — the
existing type-vs-value AST classification already handles this class correctly today for
`@/lib`/`@/db`, so extending the same classification to `@/components` edges (rather than a
naive regex) avoids introducing that risk.

## Also examined, no material finding

- **Migration/schema-drift runbook (`scripts/migrate.js`):** spot-checked against
  `CLAUDE.md`'s documented pending-vs-drift split, mixed-batch guard, and DML-baseline guard;
  no new drift found versus the extensively-hardened C1/C3/C4 history.
- **ETag/cache-invalidation (`serve-upload.ts`, `next.config.ts`, `settings-hash.ts`):** the
  path-stat vs fd-stat dual-ETag construction (`buildDerivativeEtag`), the 5s
  stale-while-revalidate settings-hash cache, and the two `uploads/[...path]` route twins are
  internally consistent and match the documented contract; no drift found.
- **`instrumentation.ts` startup ordering:** `syncRestoreMaintenanceFromDurable()` runs first
  (synchronous, before the maintenance scheduler or queue bootstrap starts), so a durable
  restore marker is honored before either subsystem can act — correct ordering. The
  single-writer guard is deliberately last and fire-and-forget (warn-only, documented).
  Shutdown drain order and the SIGTERM/SIGINT handled-state guard are correct.
- **Advisory-lock registry discipline:** every `GET_LOCK`/`RELEASE_LOCK` call site in `src`
  and `scripts` routes through a named constant from `advisory-locks.ts`; no ad hoc inline
  lock-name string literals found, so the centralization (`C9-MED-03`) has not eroded.
- **Maintenance-scheduler lifecycle:** startup-sweep-once guard, in-flight dedupe, and the
  restore-drain timeout/race are consistent with `CLAUDE.md`'s description; no new hazard.

## Summary

1 new finding (`ARCH10b-01`), Medium severity / High confidence: the `client-server-only-boundary.test.ts`
guard's DFS only follows `@/lib`/`@/db` edges, so a leak routed through an intermediate
`@/components/*` module (two real near-miss examples already exist in `nav.tsx` and
`on-this-day-widget.tsx`, both currently safe because they're only imported from Server
Component entry points) would pass this fast test green and regress to the opaque
build/runtime-failure class the test exists to prevent. No live violation exists today — this
is a structural test-coverage gap, not an active bug. All three `cycle-9b` findings
(`ARCH9-01/02/03`) were verified closed at HEAD. No other new architectural finding surfaced
this cycle across migration runbook, ETag/cache-invalidation, instrumentation startup
ordering, maintenance-scheduler lifecycle, or advisory-lock scope — the codebase remains
highly converged in these areas.
