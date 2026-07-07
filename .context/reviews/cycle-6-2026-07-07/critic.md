# critic review — cycle 6

## Summary
Multi-perspective critique of the committed change surface at HEAD `583277fb`, focused on
non-peer-dirty files (the CLIP/semantic/timeline/data churn is owned by a second session).
The code is exceptionally well-hardened; the strongest NEW signal is architectural — the DB
restore-quiescence path is an unenforced manual checklist of drains, and *this cycle* had to
add the previously-missing maintenance-sweep drain, proving the "forgot to drain a background
writer" failure mode recurs. I also skeptically re-verified a sample of "closed/locked"
honesty invariants (color admin-gating, privacy compile-guard, shared OG sanitizer,
hdr-filenames un-wired, COLOR_IMPACTING_KEYS count) — all hold.

## Findings

### F1 — Restore quiescence is an unenforced manual drain-checklist that already regressed this cycle  [SEV: MED | CONF: High | apps/web/src/app/[locale]/admin/db-actions.ts:540-567]
**Problem.** Before importing a backup, `restoreDatabase()` must individually drain every
process-local DB-write source: `flushBufferedSharedGroupViewCounts()`,
`quiesceImageProcessingQueueForRestore()`, `drainBackgroundDbWritesForRestore()`,
`drainMaintenanceSweepsForRestore()`, and `drainAdminMutationsForRestore()`
(db-actions.ts:542-563), plus the color/semantic backfill advisory locks acquired earlier.
There is no registry, type, or test that enforces "every background writer is represented
here." Correctness depends entirely on a human remembering to wire a drain when a new
process-local writer is added.

**Evidence it recurs, not hypothetical.** `drainMaintenanceSweepsForRestore()` was ADDED to
this exact block *this cycle* (commit `cae5fbd9`, preceded by `d66fb08d` "surface restore-window
scheduler regression"). Until that fix the hourly maintenance sweep — including
`purgeOldViewEvents()`'s chunked `DELETE` (`maintenance-scheduler.ts:33-39`) — could run inside
the restore drain window and issue deletes against rows the import was about to replace. The
scheduler is an independent `setInterval` (`maintenance-scheduler.ts:76`, `instrumentation.ts`),
so it was invisible to the restore author's mental model of "writers." That is precisely the
class of miss this finding is about; it happened.

**Failure scenario.** A future feature adds another process-local buffered/queued writer (e.g.
a new analytics aggregation timer, a deferred thumbnail-metadata writer). Its author does not
touch db-actions.ts. Restores then import over that writer's in-flight commits, silently
corrupting the restored state with rows from the pre-restore DB — with no error, because the
restore's own abort-on-undrained checks only cover the sources they know about.

**Fix.** Introduce a single registry (e.g. `registerRestoreDrainable({ name, drain })`) that
every background writer opts into, have `restoreDatabase` iterate it, and add a source-contract
test asserting each known process-local writer module registers a drain (mirroring the existing
`maintenance-scheduler-source`/`background-db-writes` contract tests). At minimum, add a comment
block at db-actions.ts:542 enumerating the invariant "add a drain here for every new
process-local DB writer" so the checklist is discoverable.

### F2 — Restore drain budget (5 s) is tight against a chunked-DELETE maintenance sweep → spurious restore aborts  [SEV: LOW-MED | CONF: Medium | apps/web/src/lib/maintenance-scheduler.ts:56, apps/web/src/app/[locale]/admin/db-actions.ts:546-550]
**Problem.** `drainMaintenanceSweepsForRestore()` defaults to a 5 s timeout
(maintenance-scheduler.ts:56) and the restore ABORTS (`return restoreFailed`) if the in-flight
sweep does not settle in that window (db-actions.ts:547-550). `runMaintenanceSweepOnce()` only
re-checks `isRestoreMaintenanceActive()` BETWEEN tasks (maintenance-scheduler.ts:34-38), not
inside `purgeOldViewEvents()`'s chunked delete loop. On a gallery with a large `image_views`
table (public, anonymous, per-IP-rate-limited but high-volume), a sweep that begins moments
before an admin clicks Restore can hold the drain past 5 s mid-chunk, so the restore fails with
a generic error the admin cannot diagnose or act on.

**Contrast.** The peer session's new SIGTERM path uses `stopMaintenanceScheduler({ timeoutMs: 15_000 })`
(instrumentation.ts) — 3× the restore drain budget for the same sweeps — which underlines that
5 s is an under-justified number here.

**Fix.** Either raise the restore drain budget to match (or exceed) the shutdown budget, or make
the chunked deletes cooperatively cancel on `isRestoreMaintenanceActive()` between chunks so the
sweep yields promptly when a restore begins. A retry/clearer operator message ("maintenance
sweep in progress, retry") beats a bare `restoreFailed`.

### F3 — DB-TLS hardening throws at module import and removes the system-CA option (upgrade footgun)  [SEV: MED | CONF: Medium | apps/web/src/db/index.ts:11-19, apps/web/scripts/mysql-connection-options.js:14-28]
**Problem.** Cycle-8 (commit `44ab13c4`) changed non-local DB TLS from
`{ ssl: { rejectUnauthorized: true } }` (validate against Node's system CA store) to
`{ ssl: { ca: readFileSync(caPath), rejectUnauthorized: true } }`, and now THROWS if
`DB_SSL_CA` is unset for a non-local `DB_HOST`. Two critic concerns:
1. **Whole-process failure mode.** The throw is evaluated in a top-level IIFE at
   `db/index.ts` import time. A non-local deployment that upgrades without setting `DB_SSL_CA`
   does not merely lose DB access — importing `@/db` throws, so instrumentation, `/api/live`,
   `/api/health`, and every route/server-action 500. A fail-closed posture is defensible, but a
   clean startup probe (log + non-zero exit, or a degraded-but-responding health surface) is
   operationally safer than an import-time crash that also blackholes liveness.
2. **Removes a previously-valid secure config.** With `ca:` set, Node uses ONLY that CA and no
   longer trusts the system store. A self-hoster pointing `DB_HOST` at a managed/public-CA
   MySQL (the old `rejectUnauthorized: true` path validated these fine) must now extract and pin
   the exact CA, and is exposed to breakage when the provider rotates to a different root. There
   is no "verify against system CAs" escape hatch anymore — only pin-a-file or `DB_SSL=false`.

**Mitigation already present.** README.md:170, apps/web/README.md:52, and `.env.local.example`
document the fail-closed requirement, so this is partly a deliberate, documented posture. The
residual gaps: CLAUDE.md:94's env-table wording still reads as optional ("CA path for verified
… when …"), not "required or the app won't boot"; and no clean boot-time diagnostic exists.

**Fix.** Do the CA check in an explicit startup guard (instrumentation) that logs an actionable
message and exits, rather than an import-time throw; consider allowing the system-CA path
(`rejectUnauthorized: true`, no `ca`) as an opt-in for public-CA providers; tighten CLAUDE.md:94
to state DB_SSL_CA is mandatory for non-local hosts.

### F4 — `check-action-origin` scanner clears but never restores rate-limit state around `trackAnalyticsDbWrite`  [SEV: LOW | CONF: Medium | apps/web/scripts/check-action-origin.ts:774-778, 983-989]
**Problem.** `restoreOnlyRateLimitState()` (misnamed — it CLEARS, not restores) zeroes
`sawRateLimitGate` and the result-name sets when the scanner descends into a
`trackAnalyticsDbWrite(callback)` body, then processes the callback statements and `return`s
without re-establishing the pre-callback state. Statements AFTER the analytics call in the same
action body are then scanned as if no rate-limit gate had been seen.

**Direction is safe but brittle.** A cleared gate can only make the scanner flag a
mutation-before-gate (false POSITIVE / over-strict CI failure), never miss one — so this is not
a security bypass. But it means a legitimately-gated public action that mutates AFTER a
`trackAnalyticsDbWrite(...)` will fail `lint:action-origin` for reasons unrelated to its actual
safety, forcing awkward code ordering. The misleading name compounds the maintenance risk.

**Fix.** Snapshot the state before descending into the analytics callback and restore it after
(true save/restore), or scope the clear to a child scanner instance; rename to
`clearRateLimitStateForNestedScope()`.

### F5 — New privacy source-string test can pass vacuously if module markers drift  [SEV: LOW | CONF: Medium | apps/web/src/__tests__/privacy-fields.test.ts (added commit 09a0dcd3)]
**Problem.** The new "standalone public select modules do not alias sensitive image columns"
test extracts each select block with `sourceBetween(source, '<start marker>', '} as const;' / '};')`
and regex-scans the extracted substring for `<alias>: images.<sensitiveKey>`. If a future edit
renames the variable, reorders the block, or reformats the closing token, `sourceBetween` can
return an empty/partial string and the regex matches nothing → the test passes while genuinely
leaking a sensitive column alias. This is the same source-string-brittleness class already
tracked (AGG-C10-09/10/11) but a NEW instance guarding a real privacy invariant
(timeline/search-enrichment public selects).

**Fix.** Assert the extracted block is non-empty and contains at least one expected public key
before running the leak regex, so a marker drift fails loudly instead of vacuously passing;
better, import the actual field objects and check `Object.keys` at runtime (as the sibling
`_PrivacySensitiveKeys` compile-guard does) rather than scanning source text.

## Skeptical re-verification of "closed/locked" honesty invariants (all HOLD)
Per the mandate to distrust "locked by test" claims, I verified a sample against the actual
committed code (peer-dirty files checked at `git show HEAD:`):
- **Color/HDR admin-gating (holds).** `is_hdr`/`transfer_function` badges are gated on
  `isAdmin && isHdr` at every render, label, and clipboard point
  (color-details-section.tsx:155,236,386,532; lightbox-color-pip.tsx:84 makes `isHdr` false
  for non-admins outright). A public viewer cannot see an HDR badge.
- **Privacy compile-guard (holds).** At data.ts HEAD:473-475 the
  `_SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>` +
  `_privacyGuard: … extends never ? true : [ERROR]` pattern is a real tsc tripwire; a sibling
  guard covers `searchFields` (HEAD:1613).
- **Shared OG sanitizer (holds).** `sanitizeForOg` from `@/lib/og-sanitize` is imported and
  applied by all three consumers (api/og/route.tsx:5, api/og/photo/[id]/route.tsx:9,
  [locale]/(public)/p/[id]/page.tsx:14).
- **hdr-filenames reserved/un-wired (holds).** No non-test importer of `hdr-filenames` /
  `_hdr.avif` exists in `apps/web/src`.
- **COLOR_IMPACTING_KEYS = 9 (holds).** 5 color + 3 quality + 1 size, with the
  `_ColorKeysAreSettingKeys` compile-guard (settings-hash.ts:56-58) and `image_sizes` sorted
  ascending before hashing (settings-hash.ts:92).

## Also inspected — no NEW finding
- **Restore fence (auth.ts:291-312, db-actions.ts:540-612)** — password-change and DB-restore
  fences are correctly ordered (same-origin → auth → maintenance-marker → mutation-slot) and
  airtight against the marker/slot TOCTOU; `using mutationSlot` releases on every path. Solid.
- **serve-upload.ts** — fd-stat race safety, abort-listener fd cleanup (AGG-H5), SWR settings-hash
  cache, and cached upload-root realpath are all coherent and leak-free on the paths I traced.
- **smart-collections.ts** — parameter-bound compiler, per-column operator narrowing, scalar-value
  enforcement, depth/node/child budgets, and topic-slug remap are consistent between validate and
  compile paths. (Topic-delete fail-open on malformed predicates is the known AGG-C10-18.)
- **photo-viewer.tsx / image-zoom.tsx (cae5fbd9)** — the sessionStorage read correctly moved out
  of the render-phase lazy initializer (fixes a real SSR/hydration mismatch); the
  `role="button"` self-match fix in `handleClick` is correct.
- **Analytics layout move (44ab13c4)** — GA correctly relocated to the public-only layout (off
  admin/root); parent layout still computes its nonce for other scripts. Boundary test is
  source-string only (the known class), not a NEW gap.
- **migrate.js preflight (20e9048e)** — the `processing_error`/`failed_at` idempotent pre-create
  for historical migration 0025 on the pending-tail path is narrow and correct; it reinforces the
  known schema-authority split (AGG-C10-07) but is not a new defect.

## Files examined (inventory)
db-actions.ts, auth.ts, maintenance-scheduler.ts (@HEAD), restore-maintenance callers (grep),
serve-upload.ts, uploads route handlers, smart-collections.ts, db/index.ts,
mysql-connection-options.js, migrate.js (preflight), check-action-origin.ts,
color-details-section.tsx, lightbox-color-pip.tsx, settings-hash.ts, og-sanitize consumers,
hdr-filenames (grep), data.ts (@HEAD: publicSelectFields guard), privacy-fields.test.ts,
(public)/layout.tsx, [locale]/layout.tsx, analytics-layout-boundary.test.ts,
about-gallerykit/page.tsx, not-found.tsx, not-found-document-title.tsx.
Prior context read: `.context/reviews/_aggregate.md` (cycle-10, AGG-C10-01..20),
`.context/plans/deferred-carry-forward.md`.

## Final sweep (commonly-missed) notes
- Peer-dirty churn (CLIP/semantic/timeline/data/schema/image-queue/instrumentation) was left to
  the owning session; where I touched them I read committed HEAD. The maintenance-scheduler
  shutdown rework in flight there (AGG-C10-12) overlaps F1/F2 — coordinate so the drain-registry
  idea and the SIGTERM `stopMaintenanceScheduler` land coherently.
- No secrets, no obvious injection sinks introduced in the reviewed diffs; SQL paths reviewed
  (smart-collections, serve-upload path containment) are parameter-bound / allowlisted.
- The recurring theme across this repo's history — "fix one sibling, miss the next" (touch-target
  tag classes, `max-` lookbehind, now restore-drain sources) — is the meta-signal behind F1: the
  invariant needs mechanical enforcement, not another hand-added case.
