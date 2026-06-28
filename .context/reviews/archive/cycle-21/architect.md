# Architect Review — Cycle 21 (GalleryKit, HEAD 993ed471)

**Date:** 2026-06-29
**Scope:** architectural & design risk — coupling, cohesion, layering, module boundaries, leaky abstractions, convention-only invariants, scale/evolution hazards.
**Findings:** 0 NEW risks · 1 cycle-20 framing CORRECTION (ARCH21-01, lowers N2 urgency) · 1 consolidated process-local-state inventory (ARCH21-02) · 6 deferred re-evaluations (A1, A3, A4, A5, A6, N1 — **all exit criteria UNMET**) · 2 healthy-boundary reconfirmations.

## Summary
The codebase is **architecturally byte-stable** since cycle-20: `db/schema.ts` and `lib/data.ts` are unchanged (verified `git diff 9af705f4..HEAD` empty for both), no migrations added (last is `0024`), no new modules. The 9 landed commits are all the cycle-20 T1–T7 fixes plus the SW stamp — none touched a structural surface. **Every deferred exit criterion is therefore UNMET**, and none of the deferred items should be re-reported as changed. The only substantive movement is a **correction to cycle-20's framing of N2**: its public consumers (`data-timeline.ts`, `search-enrichment-fields.ts`) import the privacy contract via `import type` (runtime-erased), so **no public route transitively pulls the 1722-line `data.ts` at runtime**. N2 is purely cohesion/merge-blast-radius — NOT a runtime layering violation — which lowers its urgency to "opportunistic cleanup," correctly bundled with N1+A6. The two recurring "make-it-structural" wins remain N1 (derive the `PrivacySensitiveKeys` union, gated by the E4 tautology caution) and the data.ts extraction (A6+N2). A1 is now the **best-fenced** deferred item: its hand-maintained rename fan-out is 4 re-point sites, ALL test-pinned, with the only un-fenced path being exactly its widened exit criterion.

---

## CYCLE-20 FRAMING CORRECTION

### ARCH21-01 — N2's runtime-coupling premise is FALSE; N2 is cohesion-only, not a layering violation — CORRECTION · LOW · High confidence
**Module:** `lib/data-timeline.ts:14` (`import type { PrivacySensitiveKeys } from '@/lib/data'`), `lib/search-enrichment-fields.ts:27` (same `import type`).

**What cycle-20 recorded.** The cycle-20 architect.md (N2) argued the select-field contract being anchored in `data.ts` means "each new public read surface … re-copies the publicSelectFields shape rather than importing one canonical contract, because importing it means importing `data.ts`" — i.e. a *runtime* coupling cost driving duplication.

**What is actually true (verified).** Both cross-module consumers import the contract **type-only** (`import type`, erased by `tsc`/SWC). `data-timeline.ts`'s value imports are only `@/db` + `drizzle-orm` (`data-timeline.ts:11-13`); it pulls **nothing** from `data.ts` at runtime. So the public timeline (`/timeline`, `/year/[year]`, on-this-day) and the public semantic/similar search routes carry **zero runtime dependency** on the heavy module via the privacy contract. The compile-guard pattern (`Extract<keyof …, PrivacySensitiveKeys>`) is intentionally type-only precisely so routes don't transitively load `data.ts` — `search-enrichment-fields.ts:18-24` documents this.

**Consequence for the planner.** N2's only remaining justification is **cohesion / merge-conflict blast radius** (the security-critical select region lives in the most-patched file). There is **no runtime cost** to leaving it. The extraction to `lib/image-select-fields.ts` is still the right cleanup, but it is **pure maintainability**, not a coupling/perf fix — do not prioritize it as a layering violation. Land it only when `data.ts` is next opened structurally, bundled with N1 (E4) + A6. **Confidence High** (import-type verified at both sites).

---

## CONSOLIDATED INVENTORY (no new risk; map for future scale-out)

### ARCH21-02 — Process-local mutable state is now 6 independent islands; only one is correctness-critical (A4) — INVENTORY · informational
The single-writer topology's process-local state, fully enumerated at HEAD:

| # | State | Module | Scale-out failure class | Fence |
|---|-------|--------|------------------------|-------|
| 1 | restore-maintenance flag | `lib/restore-maintenance.ts:7` (`Symbol.for('gallerykit.restoreMaintenance')` globalThis boolean) | **CORRECTNESS** (instance B writes against DB mid-restore) | single-instance Docker topology only → **A4** |
| 2 | backfill-runner status | `lib/admin-backfill-runner.ts` | analytics/status only (correctness fenced by `LOCK_COLOR_PIPELINE_BACKFILL` advisory lock) | advisory lock + per-process status |
| 3 | view-count write-buffer | `lib/data.ts:12-242` | best-effort analytics undercount (by design) | SIGTERM drain → **A6** |
| 4 | upload-tracker window | `lib/upload-tracker.ts` + `lib/upload-tracker-state.ts` | per-IP quota defense weakens | **already its own clean module pair** |
| 5 | rate-limit buckets (OG/share/search/semantic) | `lib/rate-limit.ts` | distributed-attack defense weakens | per-process bounded Maps |
| 6 | login rate-limit buckets | `lib/auth-rate-limit.ts` | brute-force defense weakens | **DB-backed** for login |

**Observation.** There is no shared seam/registry abstracting "this state is process-local and breaks under scale-out"; the contract is documented in prose (CLAUDE.md "Runtime topology"). Only **#1 (restore-maintenance)** is a *correctness* hazard under scale-out — the rest are analytics/defense degradation the repo explicitly accepts. This table is the map any future multi-replica decision must consult; **A4 is the single mandatory pre-scale-out fix**. **Notably, #4 (upload-tracker) is already extracted into its own module pair — that is the exact model A6/N2 should follow when data.ts is next opened.** No new finding; pure consolidation.

---

## DEFERRED-ITEM RE-EVALUATION (exit-criteria check — ALL UNMET)

### A1 — topics.slug mutable natural key + manual FK fan-out — STILL-DEFERRABLE (exit UNMET), now BEST-FENCED
`db/schema.ts:16,33,236` — still exactly **3 FK children** (`topic_aliases.topic_slug`, `images.topic`, `topic_views.topic`), no 4th, none with `onUpdate:'cascade'`. The rename transaction (`actions/topics.ts`) now hand-maintains **4 re-point sites**: the 3 FK columns (`:283/:284/:292`) **plus** the non-FK `smart_collections.query_json` JSON store (`:301-327`, AST remap via `remapTopicSlugInQuery`, DBG-16-03). **All 4 are test-pinned:**
- FK children: `topic-slug-fk-registry.test.ts` derives the FK set from schema.ts by regex and asserts set-equality with the re-point list — a NEW FK child **fails the build**.
- JSON referrer: `topics-actions.test.ts:345` ("re-points smart-collection topic predicates … inside the rename transaction") pins the current single JSON referrer behaviorally.

**Exit status.** The widened criterion is "4th FK child OR **2nd** non-FK (JSON/SQL-only) referrer OR routine renames." There is **1** non-FK referrer (`smart_collections.query_json`) — the FK-registry test header explicitly excludes it from its derivation ("plus the non-FK `smart_collections.query_json` JSON store"). The single **un-fenced path** is a *future 2nd non-FK referrer* (e.g. a "featured topics" admin setting storing slugs) added without a re-point — and that is **exactly** the exit criterion. Verified there is no such 2nd referrer today (no admin_settings topic-slug value, no nav/site-config slug store, no other JSON column). **Exit UNMET; this is the best-fenced deferred item — correctly deferred.**

### A3 — upload quota-claim, no single settle point — STILL-DEFERRABLE (exit UNMET; span NOT reopened)
`actions/images.ts:226-592` — verified `git diff 9af705f4..HEAD` added **0 new `await` lines** in the upload claim→settle span. The only change to the file is the env-parse T1 fix at `:796` (`CLEANUP_CONCURRENCY` in `deleteImages`), which is a different function entirely outside the span. The 6 hand-placed settles + 2 comment-only invariants are byte-identical to cycle-19/20. Exit criterion (new await between claim `:228` and final settle `:564`, OR fresh leak) **not met**. The cycle-20 split decision (critic now-actionable vs architect defer) stands; the `claimSettled` try/finally restructure remains the correct fix the moment any edit reopens that span. **(A3 is not in cycle-21's named deferred set but re-verified for completeness.)**

### A4 — restore-maintenance flag: correctness-critical process-local state — STILL-DEFERRABLE (exit UNMET)
`lib/restore-maintenance.ts:7` unchanged — still a `Symbol.for('gallerykit.restoreMaintenance')` globalThis-keyed per-process boolean. `LOCK_DB_RESTORE` serializes restores, but the FLAG that 503s mutating actions is per-process; under accidental scale-out, instance B accepts writes against a DB mid-restore → silent corruption. The single-web-instance Docker topology remains the only fence; multi-replica not contemplated (no compose/k8s replica config landed). Exit criterion **not met**. Of all 6 process-local-state islands (ARCH21-02), this is still the **only** one whose scale-out failure is *correctness* — keep it flagged as the mandatory pre-scale-out item.

### A5 — `@/lib/storage` createReadStream lacks public-dir whitelist — STILL-DEFERRABLE, fencing intact (exit UNMET)
`lib/storage/local.ts` unchanged; **zero non-test importers fleet-wide** (re-verified across `src`, `scripts`, `e2e`). `storage-quarantine.test.ts` remains the AST-based CI tripwire that fails the build on the first non-test import. The underlying smell (`createReadStream` streams any key incl. `original/`, lacking serve-upload's `ALLOWED_UPLOAD_DIRS` whitelist) is unchanged but the path-to-exposure is gated. Exit criterion ("first live importer") **not met**. Recommendation unchanged: prefer deletion (dead + guarded); if kept, add `ALLOWED_PUBLIC_DIRS` parity when the quarantine test is next touched.

### A6 + N2 — view-buffer + select-contract embedded in 1722-line data.ts — STILL-DEFERRABLE (exit UNMET)
`lib/data.ts` is **byte-unchanged** since cycle-20 (verified empty diff): the view-count debounced-flush state machine still occupies `:12-242`, the select-field privacy contract `:244-495`, the read-query layer `:497-1690`, SEO settings `:1698-1722` — ≥4 responsibilities, 1722 lines. No behavioral change, no 2nd write-buffer added. Exit criterion (next behavioral change OR 2nd stateful write-buffer) **not met**. Per ARCH21-01, N2 is cohesion-only (no runtime coupling) — extract `lib/image-select-fields.ts` + bundle the view-buffer extraction (mirroring the already-clean `upload-tracker.ts` pair) when data.ts is next opened.

### N1 — `PrivacySensitiveKeys` hand-maintained union — STILL-DEFERRABLE (exit UNMET)
`lib/data.ts:461` is still the hand-typed **20-key** string-literal union (E4 derived-union fix did NOT land), consumed by **5** `Extract<…, PrivacySensitiveKeys>` guard sites across **3** modules (`data.ts` ×3 at `:463/:1500` + the map-derived `:474`, `data-timeline.ts:65`, `search-enrichment-fields.ts:43`). No new migration/PII column added, so no opportunity to drift; the union and the test `SENSITIVE_KEYS` list still agree (the `privacy-fields.test.ts` symmetric assertion auto-derives PII from actual `adminKeys \ publicKeys`, so it would catch drift regardless). Exit criterion (new PII column) **not met**. The E4 CAUTION holds: the naive `Exclude<keyof admin, keyof public>` replacement makes `_SensitiveKeysInPublic` tautological — only the **additive bidirectional assertion** variant is safe. Implement E4 before the next admin-only column migration, OR when a 6th guard site is added.

---

## HEALTHY BOUNDARIES (verified, no action)
- **Advisory-lock coordination model** — `lib/advisory-locks.ts` is a **centralized constants registry** (C9-MED-03 extracted prior scattered literals), **consumed by import** at 6 call sites (`image-queue.ts`, `admin-backfill-runner.ts`, `upload-processing-contract-lock.ts`, `actions/admin-users.ts`, `actions/topics.ts`, `admin/db-actions.ts`). No re-typed literals at call sites; the server-scope multi-tenant caveat is documented in the registry header. Clean.
- **Config resolution layering** (`gallery-config-shared.ts` → `gallery-config.ts` → `image-queue.ts`) — unchanged since cycle-20's verification; `gallery-config-shared.ts` has no db imports (client-safe), no inversion.
- **N1 privacy contract integrity** — belt (5 compile guards) + braces (derived symmetric `privacy-fields.test.ts`) both hold at HEAD; union (20) and test list agree.

## Root cause (cross-cutting, unchanged)
A1, A3, and N1 share ONE root: a privacy/integrity invariant enforced by a hand-maintained fan-out list (FK children + JSON referrer / settle calls / sensitive-key union) rather than by construction. **A1 is now the model of the durable tactical answer** — a set-equality registry test that fails the build on a new FK child, plus a behavioral pin on the JSON re-point. N1 remains the cheapest *structural* (derive-don't-list) win, gated only by the E4 tautology caution. The recurring lesson holds: every cycle that nets a symptom of a hand-maintained list should ask whether the list can be derived (N1) or build the forcing tripwire (A1's registry test).

## Findings ledger
- ARCH21-01 | LOW | High | CORRECTION | data-timeline.ts:14 + search-enrichment-fields.ts:27 — N2 is type-only/cohesion, NOT runtime coupling; lower its priority
- ARCH21-02 | info | High | INVENTORY | 6 process-local-state islands; only restore-maintenance (A4) is correctness-critical under scale-out
- A1 | MED | High | STILL-DEFERRABLE (exit UNMET), best-fenced | schema.ts:16,33,236 + actions/topics.ts:283-327 (4 test-pinned re-point sites)
- A3 | MED(generator) | High | STILL-DEFERRABLE (exit UNMET; 0 new await) | actions/images.ts:226-592
- A4 | MED(latent) | High | STILL-DEFERRABLE (exit UNMET) | lib/restore-maintenance.ts:7
- A5 | LOW | Med-High | STILL-DEFERRABLE (exit UNMET; quarantine CI guard intact) | lib/storage/local.ts
- A6 | LOW | High | STILL-DEFERRABLE (exit UNMET; data.ts byte-unchanged) | lib/data.ts:12-242
- N1 | LOW-MED | High | STILL-DEFERRABLE (exit UNMET; E4 not landed) | lib/data.ts:461 + 5 guard sites / 3 modules
