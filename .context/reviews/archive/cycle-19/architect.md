# Architect Review — Cycle 19 (GalleryKit, HEAD 5c559a0f)

Scope: architectural & design risk — coupling, layering, leaky abstractions, process-local-state-vs-scale-out, recurring structural roots. Each finding NEW / KNOWN-DEFERRED / CLOSED-ENOUGH with a re-open exit criterion.

## Summary
Cycle 18 landed its two tactical nets (FK-registry test, derived PII denylist) but NOT the upload-quota try/finally restructure (only a doc commit). Of the three structural roots, two are now netted-but-unstructured and one (quota settle) remains a live bug-generator with only a comment as its guard. Biggest residual: the restore-maintenance flag — the one process-local state whose scale-out failure is correctness (DB corruption), not analytics/defense — with no runtime fence beyond deployment convention. No NEW critical coupling this cycle.

## Findings

### A1 — topics.slug mutable natural key + manual FK fan-out — KNOWN-DEFERRED (net landed, root unchanged) · MEDIUM · High
`db/schema.ts:16,33,236` (3 FK children, none with ON UPDATE CASCADE), `actions/topics.ts:283-330` (hand re-point then recreate-delete inside one tx). Cycle-16 caused real topic_views data loss (DBG-16-01). Net landed (topic-slug-fk-registry.test.ts) but weaker than recommended: parses schema.ts source text (not INFORMATION_SCHEMA, so a DB-only FK via reconcileLegacySchema is invisible) and uses brittle text-shape regexes. Structural fix (DEFER): add onUpdate:'cascade' + in-place UPDATE, or surrogate PK. **Re-open** when a 4th FK child is added OR slug renames become routine user-facing.

### A2 — search-route enrichment selects outside privacy compile-guard, duplicated × 2 — CLOSED-ENOUGH for security / OPEN for structure · LOW-MED · High
`api/search/semantic/route.ts:293-309` + `similar/[id]/route.ts:195-210`. Public-image-field contract now exists in 3 near-copies; one compile-guarded, the two route enrichment selects hand-copied with no tsc/test guard of their own. Cycle-18 denylist improved (now derives PII set as adminKeys\publicKeys, non-vacuous ≥15) → security drift monitored adequately. Residual: structural duplication un-fixed (functional non-PII drift uncaught); denylist regex matches only `images.<col>` (a joined-table PII column would sidestep). Fix: export one guarded `searchEnrichmentSelectFields` const; both routes import it; retires the denylist. **Re-open** if a 3rd consumer appears or a cross-table column is added.

### A3 — upload quota-claim, no single settle point — KNOWN, STILL UN-STRUCTURED (live bug-generator) · MEDIUM(generator) · High
`actions/images.ts:226-228` claim, 6 hand-placed settles (:244/249/273/277/542/564), outer finally :590-592 releases only the contract lock. Only structural guard is the invariant comment at :264-265. This pattern generated the cycle-17 headline DBG-17-1. Cycle-18 flagged (A4); only a doc commit landed. Fix (the net IS the restructure): `let claimSettled=false;` + try/finally that settles(0,0) only when !claimSettled. The per-file loop is fully inner-try/catch'd so there is no committed-then-throw path → the flag-guarded finally is correct. **Re-open** the next time any new await is added between :228 and :564 (comment-only guard already failed once).

### A4 — restore-maintenance flag: correctness-critical process-local state, scale-out-unfenced — KNOWN-DOCUMENTED / NEW framing · MEDIUM(latent) · High
`lib/restore-maintenance.ts:1-60`. The restore flow acquires `gallerykit_db_restore` so two restores serialize, but the FLAG that makes mutating actions 503 is per-process. Under accidental scale-out, instance B never sees A's flag → accepts writes against a DB mid-restore → silent corruption. No runtime guard (no startup single-instance assertion, no shared flag). Of all process-local states, this is the only one both correctness-critical AND scale-out-unfenced. Fix: DB-back the flag (a row in admin_settings like semantic_search_mode) OR a startup single-instance heartbeat fence. **Re-open** mandatory before any multi-replica deployment.

### A5 — @/lib/storage createReadStream lacks public-dir whitelist (attractive-nuisance dead code) — NEW · LOW · Med-High
`lib/storage/local.ts:91-99,130-138`. Zero non-test importers (re-verified). `getUrl` blocks `original/` from public URLs (:133-135) but `createReadStream` (:91-99) streams ANY key under UPLOAD_ROOT including `original/` (private originals with pre-strip GPS EXIF). The live serve-upload.ts enforces an ALLOWED_UPLOAD_DIRS whitelist excluding original/; the abstraction does not. If wired into a public route believing it carries the same hardening → private originals publicly readable. Fix: prefer deleting the dead module; if kept, add ALLOWED_PUBLIC_DIRS whitelist + contract test. **Re-open** before the storage abstraction gains its first live importer.

### A6 — view-count write-buffer embedded in read-path data.ts — NEW (cohesion) · LOW · High
`lib/data.ts:12-242`. The first 231 lines of the "data access (read) layer" are a stateful shared-group view-count debounced-flush state machine (mutable buffers, timers, backoff, SIGTERM drain) — a separate write-path responsibility bolted onto a read module, and its most-patched region. Fix: extract to `lib/shared-group-view-buffer.ts`. **Re-open** on its next behavioral change or if a 2nd stateful write-buffer lands in data.ts.

## Root cause (cross-cutting)
A1, A3, and the historical author-name leak share ONE root: hand-maintained fan-out lists guarded by comments/text-matching instead of by construction ("fix one sibling, miss the next"). The durable fix is to make the invariant structural (CASCADE/in-place UPDATE; try-finally RAII; one exported guarded const).

## Findings ledger
- A1 | MEDIUM | High | KNOWN-DEFERRED | db/schema.ts:16,33,236 + actions/topics.ts:283-330
- A2 | LOW-MED | High | security CLOSED-ENOUGH / structure OPEN | api/search/{semantic,similar}/route.ts
- A3 | MEDIUM(generator) | High | KNOWN, UN-STRUCTURED | actions/images.ts:226-592
- A4 | MEDIUM(latent) | High | KNOWN-DOC / NEW framing | lib/restore-maintenance.ts
- A5 | LOW | Med-High | NEW | lib/storage/local.ts:91-99
- A6 | LOW | High | NEW (cohesion) | lib/data.ts:12-242
