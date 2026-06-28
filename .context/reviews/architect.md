# Architect Review — Cycle 22 (GalleryKit, HEAD 6ef2495d)

**Date:** 2026-06-29
**Scope:** architectural & design risk — coupling, cohesion, layering, module boundaries, leaky abstractions, convention-only invariants, process-local state, scale/evolution hazards.
**Baseline diff:** cycle-21 architect review was taken at 993ed471 (run-20 SW stamp); cycle-21's own fixes (70cc83eb..6ef2495d) then landed. This review diffs **993ed471..HEAD** for "what changed since the last architect pass."
**Findings:** **1 NEW** latent coupling risk (ARCH22-01, LOW) · 6 deferred re-evaluations (A1, A3, A4, A5, A6, N1 — **all exit criteria UNMET**, file:line-verified) · 2 healthy-boundary reconfirmations (1 new: post-removal cleanup is clean).

## Summary
The codebase remains **architecturally byte-stable**. Since the cycle-21 review, only four source surfaces moved and only ONE is structural: `db/schema.ts` is byte-unchanged (empty diff), `app/actions/images.ts` is byte-unchanged (A3 span untouched), `lib/restore-maintenance.ts` is byte-unchanged (A4), `lib/advisory-locks.ts` is byte-unchanged, and no migration was added (still `0024`). `lib/data.ts` grew **+6 lines** (the cycle-21 T3 retry-counter-drop fix `data.ts:167-169`, a bugfix in the existing view-buffer state machine — not a new responsibility). The single genuinely structural delta is `lib/clip-embeddings.ts:24-31`, which now reads two **server-only env vars at module-load time inside a module that is also imported by a `'use client'` component** — currently benign, but a latent client/server config-divergence trap (ARCH22-01). **Every one of the six deferred structural items has an UNMET exit criterion**, verified with current file:line evidence below. The single-writer topology assumption is **still safe**: no new correctness-critical process-local mutable state appeared; the 6-island inventory from cycle-21 is unchanged, and the new env-read constants are immutable module-load values, not coordination state.

---

## NEW FINDING

### ARCH22-01 — `clip-embeddings.ts` reads server-only env at module-load inside a client-bundled module → latent config-divergence trap — NEW · LOW · High confidence
**Module:** `lib/clip-embeddings.ts:24-31` (env-read), consumed client-side via `components/search.tsx:19` (`'use client'`, `search.tsx:1`).

**What landed (cycle-21 T4 / CRIT21-02).** `SEMANTIC_TOP_K_MAX` and `SEMANTIC_SCAN_LIMIT` were converted from plain literals to top-level `process.env` reads:
```
export const SEMANTIC_TOP_K_MAX  = envPositiveInt(process.env.SEMANTIC_TOP_K_MAX, 50);
export const SEMANTIC_SCAN_LIMIT = envPositiveInt(process.env.SEMANTIC_SCAN_LIMIT, 2000);
```
`clip-embeddings.ts` is a **leaf module** (zero `import` statements — verified) imported by BOTH server surfaces (`app/actions/embeddings.ts:18`, `api/search/semantic/route.ts:47-48`, `api/search/similar/[id]/route.ts:40`) AND the client component `components/search.tsx` (`'use client'`).

**Design risk.** A single module now exports values whose runtime meaning **differs by bundle**: server bundle = operator-configured cap; client bundle = always the fallback (`process.env.SEMANTIC_*` is `undefined` in the browser → 50 / 2000). The same imported symbol resolves to two different numbers depending on where it's referenced.

**Failure mode it enables.** Today this is harmless because `search.tsx:19` imports **only** `SEMANTIC_TOP_K_DEFAULT` (a plain `const = 20` literal at `clip-embeddings.ts:17`); the env-read constants are never referenced client-side (verified: the only consumers of `SEMANTIC_TOP_K_MAX`/`SEMANTIC_SCAN_LIMIT` are the three server modules above). The trap is **future-facing**: the first client consumer that imports `SEMANTIC_TOP_K_MAX` to clamp a UI input (e.g. cap a "results per page" selector) will silently get `50` while the server enforces the operator's configured cap — a divergence with no compile error and no test, because the server tests read the server-bundle value. The diff comment acknowledges this ("On the client bundle … the fallback applies (harmless)") but does not fence it.

**Severity LOW · latent.** No live bug; pure forward-coupling smell. The blast radius is one module and the fence is a code-review habit, not a tripwire.

**Architectural fix (DEFER with exit criterion).** Two clean options, both cheap:
1. **Preferred:** move the two env-read caps out of the client-reachable leaf module into a server-only sibling (e.g. `lib/semantic-limits.ts` imported only by the three server consumers), leaving `clip-embeddings.ts` with the client-safe pure constants/functions (`COSINE_THRESHOLD`, `SEMANTIC_TOP_K_DEFAULT`, `cosineSimilarity`, `embeddingToBuffer`). This makes "this value is server-configured" structural, not conventional.
2. Or add an `// @server-only-value` comment + a one-line guard test asserting `search.tsx` does not import the env-read symbols (mirrors the `storage-quarantine.test.ts` tripwire model).

**Do-now vs defer:** DEFER. **Exit criterion:** the first client-side reference to `SEMANTIC_TOP_K_MAX` or `SEMANTIC_SCAN_LIMIT` (anywhere under `components/` or a `'use client'` file), OR the next time a third semantic env-cap is added to this module — split the server-only caps out then.

---

## DEFERRED-ITEM RE-EVALUATION (exit-criteria check — ALL UNMET)

### A1 — topics.slug mutable natural key + manual FK fan-out — UNMET (best-fenced)
`db/schema.ts` is **byte-unchanged since cycle-21** (empty diff). Still **exactly 3 FK children** of `topics.slug`, none with `onUpdate:'cascade'`:
- `topic_aliases.topic_slug` — `schema.ts:16` (`onDelete:'cascade'`)
- `images.topic` — `schema.ts:33` (`onDelete:'restrict'`)
- `topic_views.topic` — `schema.ts:236` (`onDelete:'cascade'`)

The rename fan-out in `actions/topics.ts` re-points these 3 FK columns **plus** the 1 non-FK `smart_collections.query_json` JSON store — **4 test-pinned re-point sites** (`topic-slug-fk-registry.test.ts` set-equality + `topics-actions.test.ts:345`). The only file change this cycle (`actions/topics.ts`, +14 lines) was the T2 `Number()`-vs-`parseInt` order-parse fix — **not** in the rename fan-out. Exit criterion ("4th FK child OR 2nd non-FK referrer OR routine renames") — still 3 FK children, 1 non-FK referrer. **UNMET. Correctly deferred; remains the best-fenced item.**

### A3 — upload quota-claim, no single settle point — UNMET (span NOT reopened)
`app/actions/images.ts` is **byte-unchanged since cycle-21** (empty diff). The claim is at `images.ts:226-228` (synchronous `tracker.bytes/count` mutation before any await — the atomicity point). The 6 hand-placed `settleUploadTrackerClaim` settles are at **`:244, :249, :273, :277, :542, :564`** (identical to cycle-21). The span from claim (`:228`) to final settle (`:564`) contains **15 `await` expressions** with 6 settle sites — every early-return path must remember to settle. Exit criterion (a NEW await added in the span, OR a fresh leak) — no new await, byte-identical. **UNMET.** The `claimSettled` try/finally restructure remains the correct fix the moment any edit reopens the span (no settle site #7).

### A4 — restore-maintenance flag: correctness-critical process-local state — UNMET
`lib/restore-maintenance.ts` is **byte-unchanged since cycle-21** (empty diff). Still a `Symbol.for('gallerykit.restoreMaintenance')` globalThis-keyed per-process boolean. `LOCK_DB_RESTORE` serializes restores across the MySQL server, but the FLAG that 503s mutating actions is per-process; under accidental scale-out, instance B accepts writes against a DB mid-restore → silent corruption. It is **still the ONLY one of the 6 process-local-state islands whose scale-out failure is *correctness*** (see inventory below). The single-web-instance Docker topology remains the only fence; no compose/k8s replica config landed. Exit criterion (any multi-replica/autoscaled deployment) — **UNMET.** Mandatory pre-scale-out item.

### A5 — `@/lib/storage` dead module lacks public-dir whitelist — UNMET (and now provably the ONLY dead module)
`lib/storage/local.ts` unchanged; **zero non-test importers fleet-wide** — the only match for `@/lib/storage` outside tests is a self-referential JSDoc example in `lib/storage/index.ts:15`. `storage-quarantine.test.ts` is the AST tripwire that fails CI on the first live import. Exit criterion ("first live importer") — **UNMET.** **Strengthened this cycle:** I verified the post-removal cleanup is clean (see Healthy Boundaries) — every Stripe/paid-download/reaction module is *absent from disk*, so `@/lib/storage` is the **only** dead-but-present module in the tree. That makes "prefer deletion" the clearly correct recommendation: it is an isolated, guarded, unreferenced 5-file subtree (`index/local/minio/s3/types`) with the `createReadStream` lacking serve-upload's `ALLOWED_UPLOAD_DIRS` whitelist — delete it, or add `ALLOWED_PUBLIC_DIRS` parity when the quarantine test is next touched.

### A6 + N2 — view-buffer + select-contract in `data.ts` — UNMET
`lib/data.ts` grew to **1728 lines (+6 since cycle-21)** — the only change is the T3 retry-counter-drop at `data.ts:167-169` (`viewCountRetryCount.delete(oldestKey)` on buffer-cap eviction), a bugfix **inside** the existing view-count flush state machine (`data.ts:17-242`), not a new responsibility. The module still carries ≥4 responsibilities: view-buffer state machine (`:17-242`), select-field privacy contract (`:244-495` region incl. `PrivacySensitiveKeys` at `:467`), read-query layer, SEO settings. Per cycle-21's ARCH21-01 correction (re-verified: `data-timeline.ts` and `search-enrichment-fields.ts` import the contract via `import type`, runtime-erased), N2 remains **cohesion/merge-blast-radius only — NOT a runtime layering violation**. Exit criterion (next behavioral change OR 2nd stateful write-buffer) — the T3 change is a fix to the *existing* buffer, not a 2nd buffer. **UNMET.** Extract `lib/image-select-fields.ts` + the view-buffer pair (mirroring the already-clean `upload-tracker.ts` model) when data.ts is next opened structurally.

### N1 — `PrivacySensitiveKeys` hand-maintained union — UNMET
`lib/data.ts:467` is still the hand-typed **20-key** string-literal union (counted: latitude, longitude, filename_original, user_filename, processed, original_format, original_file_size, color_pipeline_decision, is_hdr, has_gain_map, was_downscaled, transfer_function, matrix_coefficients, bit_depth, uploaded_by, processing_error, failed_at, color_space, icc_profile_name, pipeline_version). The E4 derived-union fix did NOT land. `db/schema.ts` is byte-unchanged → **no new PII column**, so the union had no opportunity to drift and the `privacy-fields.test.ts` symmetric assertion (auto-derives PII from `adminKeys \ publicKeys`) still agrees. Exit criterion (new PII column, OR a 6th `Extract<…>` guard site) — **UNMET.** E4 CAUTION holds: only the *additive bidirectional* assertion variant is safe (the naive `Exclude<keyof admin, keyof public>` makes `_SensitiveKeysInPublic` tautological). Implement E4 before the next admin-only-column migration.

---

## PROCESS-LOCAL-STATE INVENTORY (re-verified — no 7th island; topology still safe)

Module-level mutable state scan across `lib/` confirms the cycle-21 6-island map is unchanged. Full classification:

| State | Module | Scale-out failure class | Fence |
|-------|--------|------------------------|-------|
| **restore-maintenance flag** | `lib/restore-maintenance.ts:7` | **CORRECTNESS** (instance B writes mid-restore) | single-instance topology only → **A4 (only mandatory pre-scale-out fix)** |
| view-count buffer + flush FSM | `lib/data.ts:17-70` | best-effort analytics undercount (by design) | SIGTERM drain → A6 |
| rate-limit prune ts / warn flag | `lib/rate-limit.ts:79-110` | distributed-attack defense weakens | per-process bounded Maps |
| login rate-limit buckets | `lib/auth-rate-limit.ts` | brute-force defense weakens | **DB-backed** for login |
| upload-tracker window | `lib/upload-tracker.ts` (+ `-state.ts`) | per-IP quota defense weakens | already its own clean module pair |
| backfill-runner status | `lib/admin-backfill-runner.ts` | status/analytics only | advisory lock fences correctness |

**Idempotent caches (NOT coordination state — safe under scale-out):** `avif-support.ts:22`, `image-queue.ts:77` (`bootstrapCleanupRun` — re-running bootstrap on each instance is fenced by the `gallerykit:image-processing:{jobId}` advisory lock + `WHERE processed=false` conditional UPDATE), `process-topic-image.ts:36`, `analytics.ts:33` (geoip warm), `clip-model.ts:76` (per-instance model-load promise singleton, idempotent), `serve-upload.ts:47-48`, `settings-hash.ts:79-80`, `process-image.ts:73,421`, `session.ts:13-14` (per-instance secret cache — safe IFF `SESSION_SECRET` env is set, which CLAUDE.md requires in prod). `use-display-capability.ts:47` is client-side (browser), irrelevant to server scale-out.

**Verdict:** single-writer topology assumption **STILL SAFE**. The only structural change this cycle (ARCH22-01) added immutable module-load env-read constants, not mutable coordination state — they are identical across instances when env is consistent, so they do not regress scale-out safety.

---

## HEALTHY BOUNDARIES (verified, no action)

- **Post-removal cleanup is CLEAN (new reconfirmation).** The Stripe/paid-download removal (US-P54, run-8) and reactions drop (migration `0024_drop_reactions`) left **no dead-module hoard**: `lib/stripe.ts`, `lib/license-tiers.ts`, `lib/download-tokens.ts`, `lib/download-interstitial.ts`, `app/actions/sales.ts`, `lib/reaction-rate-limit.ts`, `lib/feature-flags.ts` are all **absent from disk** (verified). The modules that *look* payment/feature-adjacent but survive are alive: `lib/download-filename.ts` (2 importers — the KEPT free direct-download), `lib/clip-inference.ts` (3 importers), `lib/caption-generator.ts` (1 importer). So `@/lib/storage` is provably the only dead-but-present subtree (see A5).
- **Advisory-lock registry** — `lib/advisory-locks.ts` byte-unchanged: 5 named constants (`LOCK_DB_RESTORE`, `LOCK_UPLOAD_PROCESSING_CONTRACT`, `LOCK_TOPIC_ROUTE_SEGMENTS`, `LOCK_ADMIN_DELETE`, `LOCK_COLOR_PIPELINE_BACKFILL`) + 1 `getImageProcessingLockName(jobId)` factory, consumed by import at 6 sites (`image-queue.ts`, `admin-backfill-runner.ts`, `actions/topics.ts`, `upload-processing-contract-lock.ts`, `actions/admin-users.ts`, `admin/db-actions.ts`). No re-typed literals; server-scope multi-tenant caveat documented in the registry header. Clean.

## Root cause (cross-cutting, unchanged)
A1, A3, and N1 still share ONE root: a privacy/integrity invariant enforced by a **hand-maintained fan-out list** (FK children + JSON referrer / settle calls / sensitive-key union) rather than by construction. A1 is the model of the durable tactical answer (set-equality registry test + behavioral pin). N1 is the cheapest *structural* (derive-don't-list) win, gated by the E4 tautology caution. ARCH22-01 is a fresh instance of the same family: a server-config value enforced by *convention* (a comment saying "harmless") rather than *structure* (a server-only module the client cannot import) — the fix is to make the boundary load-bearing, not documented.

## Findings ledger
| ID | Sev | Conf | Status | Evidence |
|----|-----|------|--------|----------|
| ARCH22-01 | LOW | High | **NEW** · DEFER (exit: first client ref to the env-read consts) | `lib/clip-embeddings.ts:24-31` + `components/search.tsx:1,19` |
| A1 | MED | High | STILL-DEFERRABLE (exit UNMET), best-fenced | `db/schema.ts:16,33,236` (byte-unchanged) + `actions/topics.ts` 4 re-point sites |
| A3 | MED | High | STILL-DEFERRABLE (exit UNMET; 0 new await, 15 awaits / 6 settles) | `app/actions/images.ts:228→564` (byte-unchanged) |
| A4 | MED (latent) | High | STILL-DEFERRABLE (exit UNMET) — only correctness-critical island | `lib/restore-maintenance.ts:7` (byte-unchanged) |
| A5 | LOW | Med-High | STILL-DEFERRABLE (exit UNMET); now provably ONLY dead module | `lib/storage/local.ts` (0 live importers; quarantine test intact) |
| A6 | LOW | High | STILL-DEFERRABLE (exit UNMET; +6 lines = T3 bugfix, not 2nd buffer) | `lib/data.ts:17-242` (1728 lines) |
| N1 | LOW-MED | High | STILL-DEFERRABLE (exit UNMET; union still 20 keys, no PII drift) | `lib/data.ts:467` + 5 guard sites / 3 modules |
