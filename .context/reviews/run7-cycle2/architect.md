# Architect Review — Run-7 Cycle-2 (HEAD `1cdbb883`)

**Date:** 2026-06-18
**Agent:** architect (Opus, READ-ONLY)
**Lane:** architectural & design risk — coupling, layering, separation of concerns, abstraction boundaries, scalability/topology, config-resolution chains, fail-open vs fail-closed, data-layer integrity, shared-state coordination under the documented single-writer Docker topology, migration/schema-drift safety, idempotency, unbounded growth, single-point-of-failure.

## Verdict: **SOUND-WITH-NOTES**

All eight assigned architectural concerns verify structurally sound at HEAD. The config chain is fail-closed, the CLIP double-gate heals end-to-end, the six advisory locks are acquire/release-symmetric on dedicated connections, the data.ts PII triple-guard is genuine compile-time enforcement (typecheck exit 0), migrate.js hash-based post-conditions hold, the storage abstraction is honest dead code, and the encoder per-format-fresh-decode boundary is intact.

**ZERO new architect-lane findings rise to schedulable severity (HIGH/MED).** I am recording **ONE LOW design note** (ARCH-R7C2-01 — Stripe Dashboard refund has no proactive state-convergence path) because it is a genuine state-convergence gap with a real (if narrow) consequence, and it has never been written into the carry-forward register as an architecture-lane item. It is defensibly DEFERRABLE, not a security/correctness/data-loss defect that forces scheduling.

This continues the architect's multi-cycle SOUND streak (run-6 c11: 0; run-7 c1: 0). A 0-finding architecture outcome is the expected baseline; ARCH-R7C2-01 is a deliberately-recorded LOW, not a manufactured finding to break the streak.

---

## Per-concern verification table

| # | Concern | Verdict | Evidence (file:line) |
|---|---------|---------|----------------------|
| 1 | Config-resolution chain fail-closed; CLIP double-gate end-to-end | **SOUND (confirmed)** | `gallery-config.ts:106-219` (try→DEFAULTS catch), `:129-148` (heal `production`→`disabled` w/o env), `gallery-config-shared.ts` validators |
| 2 | 6 advisory locks: acquire/release symmetry, dedicated connection, server-scope caveat, backfill pool budget | **SOUND (confirmed)** | `advisory-locks.ts:1-45`, `admin-backfill-runner.ts:303-368` (acquire/release pairs), `:129-142` (`resolveBackfillConcurrency` cap=2 @ pool 10) |
| 3 | data.ts PII guard: admin→public derivation + `_PrivacySensitiveKeys` + `_SensitiveKeysInPublic` compile-time enforcement | **SOUND (confirmed)** | `data.ts:208-278` (admin), `:325-357` (public by omission), `:416-420` (guard), typecheck exit 0 |
| 4 | migrate.js hash post-conditions, reconcile idempotency, baseline | **SOUND (confirmed)** | `migrate.js:144-160` (per-entry hash), `:646-700` (baseline), `:702-723` (post-condition throw) |
| 5 | Storage abstraction (@/lib/storage) not accidentally reachable | **SOUND (confirmed)** | only importer is `__tests__/storage-local.test.ts:10`; zero production import |
| 6 | Encoder per-format-fresh-decode isolation (WI-14) | **SOUND (confirmed)** | `process-image.ts:1122-1127` (fresh `sharp()` per format), `:1176` (`clone()` only WITHIN format for 8-bit fallback) |
| 7 | Stripe webhook state-convergence (charge.refunded, async_payment) | **SOUND-WITH-NOTE** | `stripe/webhook/route.ts:88` (only `checkout.session.completed`); reactive convergence at `sales.ts:231-240`; **see ARCH-R7C2-01** |
| 8 | Final sweep: unbounded growth/GC, SPOF, ordering, idempotency | **SOUND (confirmed)** | bounded rate-limit maps `rate-limit.ts:63-337`, chunked view GC `view-retention.ts:32-61`, GC armed once `image-queue.ts:704-718` |

---

## ARCH-R7C2-01 [LOW, conf HIGH] — Stripe Dashboard-issued refund has no proactive state-convergence path

**Cross-reference:** This is the architecture-angle assessment of the **tracer's flagged charge.refunded gap**. It is a real gap; I am formalizing it with an ID and a deferral exit criterion.

**Where:**
- `apps/web/src/app/api/stripe/webhook/route.ts:88` — the webhook handles ONLY `if (event.type === 'checkout.session.completed')`. No `charge.refunded`, no `charge.refund.updated`, no `refund.created` handler.
- `apps/web/src/app/actions/sales.ts:163-262` — the in-app `refundEntitlement` is the ONLY writer that sets `entitlements.refunded = true` + nulls `downloadTokenHash`.
- `apps/web/src/app/api/download/[imageId]/route.ts:180` — the download gate is `if (entitlement.refunded) → 410`.

**Failure scenario (concrete):**
1. Customer buys an image; entitlement row created with `refunded = 0` and a live `download_token_hash`; 24 h download window open.
2. Operator issues the refund **from the Stripe Dashboard** (not the in-app /sales "Refund" button) — e.g. via Stripe's own UI, a dispute auto-refund, or a Radar rule.
3. Stripe marks the charge refunded. GalleryKit receives a `charge.refunded` webhook event — but the route has no handler, so it falls through to the terminal `return NextResponse.json({ received: true })` at `route.ts:453` with no DB write.
4. The entitlement stays `refunded = 0` with a LIVE token hash. Within the 24 h window the customer can still download the asset they were just refunded for — **goods-delivered-after-refund**, the mirror of the (already-closed) money-taken-no-goods path.

**Why it is NOT already covered:** The in-app path DOES converge a Dashboard refund — but only *reactively*, the next time an admin clicks the in-app Refund button on that exact row: `sales.ts:231-240` catches Stripe's `charge_already_refunded` and converges local state. If the operator refunded on the Dashboard and never returns to the in-app /sales row (the whole point of using the Dashboard), convergence never fires. There is no webhook, no scheduled reconciler, and no read-time Stripe check.

**Severity rationale (LOW, not MED):**
- Narrow exposure window: the download token expires after 24 h (`webhook/route.ts:348`), so the goods-delivered-after-refund window self-closes within a day even with zero convergence.
- Single-use token: `download/[imageId]/route.ts` enforces single-use, so the exposure is at most one extra download.
- Operationally mitigated: the documented in-product refund path (the /sales button) sets `refunded=true` atomically with the Stripe refund call (`sales.ts:203-212`), so an operator who refunds *through the product* is fully covered. The gap is specifically the out-of-band Dashboard refund.
- Personal-gallery scale, low transaction volume.

**Architectural remediation (when scheduled):** Add a `charge.refunded` (and ideally `charge.dispute.created`) branch to the webhook that resolves the entitlement by `session_id` / payment_intent and sets `refunded = true, downloadTokenHash = null` — exactly the same two-column write `sales.ts:211` already performs. This makes Dashboard refunds converge proactively and symmetrically with the in-app path. It is the natural companion to the deferred plan-316 CRT-R5C1-04 `async_payment_succeeded` handler — both are "webhook event types the route does not yet branch on," and both touch the same entitlement-lifecycle surface, so they should land together in one Stripe-webhook-coverage pass.

**Deferral exit criterion:** (a) the plan-316 `async_payment_succeeded` handler is scheduled (then add `charge.refunded` in the same change — both are entitlement-lifecycle webhook branches); OR (b) a refund-related download incident surfaces (a customer downloads after a Dashboard refund); OR (c) Stripe Dashboard refunds become a routine operator workflow (vs. the in-app button).

---

## Architecture-angle assessment of the debugger's OBS-R7C2-02 / OBS-R7C2-03 and INFO-R7C2-08

### OBS-R7C2-02 — position-column backfill not re-runnable after a partial-run crash — **ACCEPTABLE (bootstrap-only edge case, self-degrading)**

**Where:** `migrate.js:469-481`. The position backfill UPDATE runs ONLY `if (addedPosition)` (i.e. the `ALTER ... ADD COLUMN position` actually added it this run).

**Architecture assessment:** This is a real non-idempotency, but the blast radius is tightly bounded and the failure mode is benign:
1. **Reconcile-path-only.** This block lives inside `reconcileLegacySchema`, which executes ONLY on (a) a completely fresh DB bootstrap or (b) a legacy DB whose `__drizzle_migrations` journal is incomplete (`prepareLegacyDatabaseIfNeeded`, `:663-700`). A normal, healthy deploy with full journal coverage never enters `reconcileLegacySchema` at all — for those DBs the `position` column ships via migration `0001_sync_current_schema.sql`. So the crash window is bootstrap-only.
2. **The crash window is microscopic.** The ALTER and the UPDATE are consecutive statements on the same connection. To strand positions at 0 you need the process to die in the few-ms gap between an `ALTER TABLE ... ADD COLUMN` returning and the next `UPDATE` issuing, on the very first init of a legacy/fresh DB.
3. **The degraded state is benign, not broken.** Even if every position stays at the DEFAULT 0, the consuming query orders by `asc(sharedGroupImages.position), asc(sharedGroupImages.imageId)` (`data.ts:1218`) — there is a deterministic `imageId` secondary sort. So a stranded-at-0 table renders shared-group images in stable `imageId` order, not in random/broken order. The user-visible consequence is "shared-group photos appear in upload order instead of the curated order," recoverable at any time by re-ordering in the admin UI.

**Verdict: ACCEPTABLE.** Not worth scheduling on its own. If a hardening pass on the reconcile path is ever opened, the trivially correct fix is to drop the `if (addedPosition)` guard around the UPDATE (the `WHERE sgi.position = 0` filter already makes the UPDATE idempotent and a no-op once positions are set) — but the current code is not a defect that warrants a dedicated change. I concur with treating it as a documented bootstrap-only edge case.

### OBS-R7C2-03 — (debugger-flagged; assessing from architecture angle)

I did not receive the OBS-R7C2-03 text in my brief, only the ID. From the architecture lane, the patterns adjacent to OBS-R7C2-02 (reconcile-path idempotency) all hold: every `ensureColumn` / `ensureIndex` / `ensureForeignKey` / `ensureTable` helper (`migrate.js:197-224`) is INFORMATION_SCHEMA-guarded and idempotent, and the one data-backfill side effect (position) is the OBS-R7C2-02 case above. If OBS-R7C2-03 concerns a different reconcile-path data backfill, the same self-degrading bootstrap-only reasoning applies. **Defer to the debugger's primary classification; from the architecture angle I see no reconcile-path idempotency hole beyond the benign position one.** (Flagged as needs-manual-validation against the debugger's actual OBS-R7C2-03 text.)

### INFO-R7C2-08 — orphan `0014_drop_reactions.sql` not in the journal — **ACCEPTABLE-BUT-WORTH-A-TIDY (no runtime risk; latent cleanliness/divergence)**

**Where:** `apps/web/drizzle/0014_drop_reactions.sql` exists on disk but is NOT an entry in `meta/_journal.json` (the journal's idx-14 entry is `0014_add_icc_profile_name`, confirmed at `_journal.json` idx 14). The reactions table itself is created by `0007_image_reactions.sql` (idx 7, IN journal).

**Architecture assessment — I traced both execution paths:**

1. **drizzle.migrate() path (existing DB, full journal coverage):** Only journal entries run. `0007_image_reactions` IS in the journal → it would create `image_reactions` + `reaction_count`. `0014_drop_reactions` is NOT in the journal → drizzle NEVER runs it. So on a DB that applied 0007 through drizzle.migrate(), the reactions table/column would PERSIST (the removed feature's DB artifacts are not dropped). This is dead schema, not a correctness bug — nothing reads `image_reactions` or `reaction_count` (grep of src/db/schema.ts + all source confirms zero references). It is wasted columns, not wrong output.

2. **reconcile path (fresh / legacy DB):** `reconcileLegacySchema` does NOT create `image_reactions` and does NOT create the `reaction_count` column (grep confirms neither appears in `migrate.js`). It then `baselineAllJournalMigrations` records the hash of `0007_image_reactions` as "already applied" WITHOUT having created the table. drizzle.migrate() then short-circuits 0007 (hash present). **Net: fresh/reconcile-bootstrapped DBs never have the reactions table at all — which is the desired end state — but they reach it by baselining-as-applied a CREATE that never ran, rather than by running CREATE-then-DROP.**

**Why this is structurally OK but untidy:**
- **No runtime risk on either path.** Both paths converge on "nothing in the app references reactions," so output is correct everywhere. The drizzle.migrate() path leaves dead columns; the reconcile path leaves none. Neither breaks.
- **The latent divergence is a runbook-contract smell, not a defect.** CLAUDE.md's migration runbook says "every new migration must have a journal entry with a strictly-greater `when`." `0014_drop_reactions.sql` is a migration FILE with no journal entry — it is the one file that violates its own runbook. It is also a *duplicate idx-14 prefix* (`0014_drop_reactions` vs `0014_add_icc_profile_name`), which is the exact non-monotonic-journal foot-gun the whole migrate.js hardening was built to defend against — except here the file is simply orphaned rather than mis-ordered.
- **The honest fix is documentation, not schema surgery.** The safest tidy is to DELETE the orphan `0014_drop_reactions.sql` file (it is unreachable dead code — no journal entry will ever run it) and rely on the fact that the reconcile path already produces the correct no-reactions schema. Adding it to the journal with a strictly-greater `when` would be WRONG: it would attempt `DROP TABLE image_reactions` on reconcile-bootstrapped DBs that never had the table (the `IF EXISTS` guard makes that a safe no-op, but it is still cleaner to delete the orphan than to journal a drop of a table the bootstrap path never creates).

**Verdict: ACCEPTABLE (no runtime risk) but a worthwhile LOW cleanliness tidy** — delete the orphan SQL file so the drizzle directory matches its own runbook invariant ("every .sql has a journal entry"). This is a docs/repo-hygiene change with zero schema effect, schedulable opportunistically. NOT a blocking finding. I defer the scheduling call to the aggregator; from the architecture angle the *only* real concern is that an orphan migration file silently violating the runbook contract erodes trust in the "every file is journaled" invariant the migrate.js defense depends on.

---

## Verified sound (no finding)

- **Config chain fail-closed (concern 1).** `_getGalleryConfig` (`gallery-config.ts:106`) wraps the entire settings read in try/catch; any DB read failure returns the full DEFAULTS object (`:189-219`). Per-key validators (`validatedNumber:100-104`, the `isValidSettingValue` guards, `isJpegChromaSubsampling` re-narrowing) each fall back to the typed default on invalid stored values — no path returns `undefined`/`NaN`/unvalidated string to a consumer. **Fail-closed confirmed.**
- **CLIP double-gate end-to-end (concern 1).** Code default `semantic_search_mode: 'disabled'` (gallery-config-shared). Resolver (`gallery-config.ts:144-147`): a stored `'production'` HEALS to `'disabled'` unless `process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true'`. An invalid stored value falls to the `'disabled'` default (`:132`). Both gates must be satisfied (env flag AND DB row) for `production` to resolve. **The double-gate holds; an unprivileged deploy can only ever resolve `disabled`|`stub`.**
- **Advisory locks (concern 2).** All 6 lock names centralized (`advisory-locks.ts:19-44`); the MySQL-server-scope (not DB-scope) caveat is documented in the file header (`:8-15`) AND CLAUDE.md. Acquire/release is symmetric on dedicated pool connections: `acquireBackfillLock`/`releaseBackfillLock` (`admin-backfill-runner.ts:303-333`) and `acquireImageProcessingClaim`/`releaseImageProcessingClaim` (`:343-368`) each pair a `GET_LOCK(name,0)` with a `finally`-released connection; the backfill lock is handed off to the runner whose single try/finally (`runBackfill:617-808`) is the sole release point. Non-blocking 0-second timeout avoids hidden queueing.
- **Backfill pool budget (concern 2).** `resolveBackfillConcurrency` (`admin-backfill-runner.ts:129-142`): `cap = max(1, floor((10 − 5 − 1)/2)) = 2` at the shipped pool of 10, with `RESERVED = max(3, ceil(10/2)) = 5`. A backfill pins at most 1 (lock) + 2×2 (workers) = 5 connections, leaving ≥5 for live traffic — enough for one full `getImage` Promise.all fan-out. NaN-guarded against a test-mock pool limit (`:137`). **The pool-starvation defense is arithmetically sound.**
- **PII triple-guard (concern 3).** `adminSelectFields` (full, `:208-278`) → `publicSelectFields` derived by destructuring-omission (`:325-357`, separate object reference) → `PrivacySensitiveKeys` union of 20 keys (`:416`) → `_SensitiveKeysInPublic = Extract<keyof publicSelectFields, _PrivacySensitiveKeys>` (`:418`) → const-assignment guard that fails to typecheck if the Extract is non-`never` (`:419`). **Genuine compile-time enforcement: typecheck exit 0 confirms no sensitive key currently leaks; a leaked key would resolve the Extract to a key name and break the `extends never ? true : [tuple]` assignment.** The parallel `_mapPrivacyGuard` (`:429-431`) and `_largePayloadGuard` (`:447-449`) extend the same pattern to the map-select and blur-payload surfaces.
- **migrate.js drift defense (concern 4).** `getAllJournalMigrations` reads one record per journal entry with `hash = SHA256(file content)` (`:144-160`); `prepareLegacyDatabaseIfNeeded` checks `every(hash ∈ recorded)` rather than `MAX(created_at)` (`:686-700`); `baselineAllJournalMigrations` inserts one row per missing hash with its own `when` (`:646-661`); `runMigrations` post-condition THROWS if any journal hash is missing after migrate() (`:702-723`). **The non-monotonic-journal foot-gun that burned production is structurally fenced; a future silent skip fails the deploy loud.**
- **Storage abstraction dead code (concern 5).** `@/lib/storage/{index,local,types}.ts` exist; the ONLY importer across the whole src tree is `__tests__/storage-local.test.ts:10`. No route, action, or pipeline imports it. **Not reachable as a supported feature — CLAUDE.md's "honest dead code" claim holds.**
- **Encoder per-format isolation (concern 6).** `generateForFormat` (`process-image.ts:1073`) opens a FRESH `sharp(processingInputPath, …)` for every format×size (`:1122-1127`); the shared `image` variable was removed (R8-R8 comment `:1049-1051`); `clone()` is used ONLY within a single format for the 10-bit→8-bit AVIF fallback (`:1176`). **No decoded instance crosses a format boundary — the WI-14 cross-format contamination boundary is intact.**
- **Bounded growth / GC (concern 8).** All in-memory rate-limit maps use `createResetAtBoundedMap`/`createWindowBoundedMap` with explicit MAX_KEYS caps (`rate-limit.ts:64-337`, caps 2000-5000). The `*_views` analytics tables (anonymous public writes) are GC'd by `purgeOldViewEvents` — chunked DELETE with a hard per-table iteration cap (`view-retention.ts:32-61`) and a negative/non-finite `VIEW_RETENTION_DAYS` falling back to the 395-day default (never a future cutoff). The hourly GC interval is armed exactly ONCE (`image-queue.ts:704-718`, AGG-M12 guard). **No unbounded-growth-without-GC surface in the architect lane.**

---

## Final commonly-missed architectural sweep

| Pattern | Result |
|---------|--------|
| Hidden coupling | None new. data.ts public/admin select coupling is the *intended* derivation; the compile-time guard makes the coupling safe. |
| Leaky abstraction | None new. Storage abstraction is fully dead (test-only import); CLIP `production` mode cannot leak through the admin UI (double-gate). |
| Fail-open default | None. Config chain fails to DEFAULTS; CLIP heals to `disabled`; HDR ingest defaults OFF; `force_srgb_derivatives` OFF (still gamut-preserved AVIF). |
| Unbounded growth without GC | None. Rate-limit maps capped; view-events chunk-GC'd hourly; shared-group view buffer best-effort-by-design (documented). |
| Single point of failure | Documented + accepted: single-writer Docker topology, process-local backfill status / restore flag / non-login rate-limit buckets. No NEW SPOF introduced; all guarded by advisory locks or DB backup where correctness-critical. |
| Ordering dependency | The migrate.js journal-`when` ordering dependency is the known foot-gun, now fenced by hash post-conditions. The orphan `0014_drop_reactions` (INFO-R7C2-08) is the one file outside the journal — benign but untidy. |
| Idempotency gap | OBS-R7C2-02 position backfill (bootstrap-only, self-degrading via imageId tiebreaker). Stripe webhook idempotent (sessionId UNIQUE + SELECT + dup-key disambiguation). Backfill idempotent (pipeline_version < CURRENT selection; no version bump on detection failure). State-convergence gap = ARCH-R7C2-01 (Dashboard refund, reactive-only). |

---

## Summary for orchestrator

- **Verdict:** SOUND-WITH-NOTES.
- **New architect-lane findings:** 0 HIGH / 0 MED / **1 LOW** (ARCH-R7C2-01 — Stripe Dashboard refund has no proactive convergence; deferrable, exit criterion = bundle with plan-316 async_payment_succeeded handler).
- **OBS-R7C2-02 (position backfill non-idempotent):** ACCEPTABLE — bootstrap-only, microscopic crash window, self-degrades to imageId order via the `data.ts:1218` secondary sort. Not worth scheduling alone.
- **OBS-R7C2-03:** needs-manual-validation against debugger text; from the architecture angle no reconcile-path idempotency hole beyond the benign position one.
- **INFO-R7C2-08 (orphan 0014_drop_reactions.sql):** ACCEPTABLE (no runtime risk on either migration path) but a worthwhile LOW repo-hygiene tidy — delete the orphan file so the drizzle dir matches its own "every .sql is journaled" runbook invariant. Schedulable opportunistically; not blocking.
- **charge.refunded gap (tracer):** formalized as ARCH-R7C2-01 above — real, LOW, deferrable, bundle with the async_payment_succeeded handler.
- **Headline:** Eight architectural invariants verified structurally sound at HEAD (config fail-closed, CLIP double-gate heals, 6 advisory locks symmetric, PII guard compiles, migrate.js drift-fenced, storage dead, encoder isolation intact, growth bounded). The only schedulable-adjacent items are two webhook-coverage gaps (Dashboard refund + async payment) that should land together, plus one orphan migration file to delete.
