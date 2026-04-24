# Architect — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: architect (layering, coupling, design
risks).

## Architecture overview

- **Presentation**: React 19 Server Components / Client Components with
  Next.js 16 App Router.
- **i18n routing**: next-intl middleware rewrites URLs with `[locale]`
  segment.
- **Routing**: `(public)/*` unauthenticated; `admin/*` gated via middleware
  + server action `isAdmin()` + same-origin check.
- **Server actions**: categorized by domain under `src/app/actions/*.ts`;
  admin DB operations in `src/app/[locale]/admin/db-actions.ts`.
- **Data layer**: `src/lib/data.ts` — drizzle ORM queries with React cache().
- **Image pipeline**: `src/lib/process-image.ts` + `src/lib/image-queue.ts`.
- **Session layer**: `src/lib/session.ts` — HMAC-SHA256 signed tokens,
  hashed for DB storage.
- **Rate limit**: `src/lib/rate-limit.ts` (primitives) +
  `src/lib/auth-rate-limit.ts` (login/password helpers).
- **Defense-in-depth**: `src/lib/action-guards.ts` + scripts/check-*.ts.

## Findings

### A6-01 — Action surface fragmentation: 9 files in `actions/` + 1 in `admin/db-actions.ts`
- Severity: LOW. Confidence: HIGH.
- Historical artifact: `db-actions.ts` lives next to the admin UI files
  under `app/[locale]/admin/` because it was originally colocated with
  the admin dashboard. Modern pattern is all server actions under
  `app/actions/`. Moving would require rewriting import paths in ~3
  components.
- Scanner (`check-action-origin.ts`) hard-codes the path as a workaround
  (cycle-5 CR6-03). A glob-discover for `**/admin/db-actions.ts` under
  `src/app/` would eliminate the hard-code.
- Fix: consolidate `db-actions.ts` into `actions/db.ts`. Out of scope for
  this cycle — deferred to architectural cleanup.

### A6-02 — `data.ts` has dual responsibility: query layer AND view-count buffer/flush orchestration
- Severity: LOW. Confidence: HIGH.
- Lines 1-109 are view-count buffering and flush logic (module-level state,
  timers, backoff). Lines 110+ are pure read queries. Two different
  responsibilities coupled in one file.
- Split: `src/lib/data.ts` (queries) + `src/lib/view-count-buffer.ts`
  (state + flush).
- AGG5R / prior cycles deferred.

### A6-03 — Privacy guard is `Extract`-based and negative-only
- Severity: LOW. Confidence: HIGH.
- Same issue as V6-F01. The guard protects against a NAMED set of PII keys
  (`_PrivacySensitiveKeys`) being accidentally included in
  `publicSelectFields`. It does NOT catch a new sensitive field added to
  `adminSelectFields` that the developer forgot to (a) add to
  `_PrivacySensitiveKeys` and (b) exclude from `publicSelectFields`.
- A stricter design: `publicSelectFields` enumerated as a whitelist of
  permitted keys; `adminSelectFields` is a union that includes the public
  whitelist plus admin-only fields. Then adding a new field to
  `adminSelectFields` without adding it to the public whitelist keeps it
  admin-only automatically.
- Fix: refactor privacy separation to whitelist-based. Non-trivial —
  touches every data-access call site that uses `{...publicSelectFields}`
  spread.

### A6-04 — Shutdown flow relies on two parallel mechanisms: `state.shuttingDown` + `isRestoreMaintenanceActive()`
- File: `apps/web/src/lib/image-queue.ts:138-141`.
- Severity: LOW. Confidence: MEDIUM.
- The enqueue guard checks both flags. Adding a third pause reason
  (e.g., "disk full") would require adding another flag AND another
  check at every enqueue site. A single `getQueueAllowedState()` helper
  would centralize.
- Fix: extract helper. Small refactor.

### A6-05 — Rate-limit primitives are split between `rate-limit.ts` and `auth-rate-limit.ts`
- Severity: LOW. Confidence: HIGH.
- `rate-limit.ts` exports checkRateLimit/incrementRateLimit/decrementRateLimit (DB primitives) and the
  in-memory `loginRateLimit` / `searchRateLimit` Maps.
- `auth-rate-limit.ts` exports `getLoginRateLimitEntry`,
  `clearSuccessfulLoginAttempts`, `rollbackLoginRateLimit`, plus the
  password-change Map and equivalents.
- Sharing.ts defines its OWN share-rate-limit Map inline rather than
  using the centralized primitives. 4 rate-limit strategies in 3 files.
- Cycle-5 deferred as D2-04.

### A6-06 — `src/lib/storage/index.ts` is dormant
- File: `apps/web/src/lib/storage/index.ts`.
- Severity: LOW. Confidence: HIGH.
- Per CLAUDE.md: "Storage Backend (Not Yet Integrated): The @/lib/storage
  module still exists as an internal abstraction, but the product currently
  supports local filesystem storage only. Do not document or expose
  S3/MinIO switching as a supported admin feature until the upload/
  processing/serving pipeline is wired end-to-end."
- The dormant abstraction pretends a design is in place. If a contributor
  grepping for "S3" starts implementing the integration on top of this
  skeleton, they may discover ambiguity. The "do not document" clause
  doesn't prevent a contributor from filing a PR adding S3 support that
  is premature.
- Fix: either complete the integration (large scope) or delete the
  dormant abstraction and start fresh when needed. Observational.

### A6-07 — CLAUDE.md has a "Permanently Deferred" section that overlaps with plan/ deferred files
- Severity: LOW. Confidence: MEDIUM.
- Section covers 2FA/WebAuthn. `plan/plan-218-cycle5-rpl-deferred.md` covers
  per-cycle deferrals. No single source of truth; a new hire would need
  to read both files to understand what's out of scope.
- Fix: link the two sections. Documentation-only. Covered by DS5-07
  (deferred).

### A6-08 — `check-action-origin.ts` subdir recursion gap
- Severity: LOW. Confidence: HIGH.
- Same as S6-06. Single-level `readdirSync` misses nested action files.
  Architectural fix: recurse. Paired with a test.

## Summary

- **8 LOW** architectural findings. None are correctness/security issues;
  most are refactor opportunities or coupling concerns. The most
  actionable architectural improvement is **A6-08** (scanner recursion)
  because it prevents future drift at minimal cost. The biggest impact
  refactor is **A6-03** (whitelist privacy guard) but it's out of scope
  for a single cycle.
- The architecture is well-layered overall: data/query layer, action
  layer, lib/primitives, UI components are distinct.
