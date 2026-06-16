# Critic — Multi-Perspective Whole-System Invariant Review (Run 6 / Cycle 5)

**HEADLINE: ACCEPT — all six challenged invariants hold at HEAD; the 5 cycle-4 fixes are correct AND complete; ZERO new actionable findings.**

**HEAD:** 2f603716 (working tree CLEAN)
**Date:** 2026-06-16
**Agent:** critic (whole-system adversarial / invariant-challenge angle)
**Mode:** THOROUGH (no escalation to ADVERSARIAL — zero CRITICAL, zero MAJOR, zero MINOR)

---

## VERDICT: ACCEPT

This is **honest convergence**, and the task explicitly recognizes that as the correct, desirable result. I challenged the six load-bearing invariants the codebase relies on (privacy compile-time guards, lint-gate airtightness, migration fail-loud post-condition, advisory-lock non-deadlock serialization, ETag/cache consistency, HDR honesty), tried to break each from the actual code, and **every one holds**. The change surface since the prior review (f8147868→2f603716) is exactly the 5 cycle-4 fixes the prior aggregate scheduled — I re-verified each is functionally correct AND complete, with no symptom-only patch, no dangling reference, no broken gate. Build is fully green at HEAD (68 changed+guard tests pass, typecheck EXIT 0, all 3 security lint gates pass).

I deliberately did NOT fabricate a marginal finding to appear rigorous. There is no path from any observation below to data loss, security breach, or correctness regression that warrants a code change at HEAD.

---

## Pre-commitment Predictions vs Findings

| # | Prediction (where I expected the whole-system trouble) | Actual finding |
|---|---|---|
| 1 | Backfill `updateResults.slice(items.length)` walk-back relies on a fragile ordering coincidence (derivative items pushed last) | **Sound, not fragile.** The transaction body pushes ALL `items` results then ALL `derivativeItems` results sequentially into `updateResults` (`backfill:407-432`); `slice(items.length)` is exactly the derivative-slice boundary. Verified. Not a finding |
| 2 | `countDeletedMidReencodeDetectionFailures` could over-subtract and drive `detectionFailures` negative | **Cannot.** Each derivative item increments `detectionFailures` once (`:480`) and produces exactly one derivative-slice `updateResults` entry; the per-batch subtraction is bounded by that batch's derivative count. No underflow. Not a finding |
| 3 | An ad-hoc public `db.select` bypasses the structural privacy guard with raw PII columns | **None.** The only public ad-hoc multi-column select is the semantic-search enrichment (`api/search/semantic/route.ts:284`), which hand-selects ONLY public-safe fields (title/description/filename_jpeg/dims/topic/camera_model/lens_model/capture_date) — no GPS, no filename_original, no uploaded_by. Stays within the public set. Not a finding |
| 4 | A mutating action escapes the action-origin scanner via a missed mutation category | **No exploitable escape.** The gate FAILS any export lacking a proper guard regardless of whether it mutates (`check-action-origin.ts:304`). A missed mutation category only narrows the exempt-comment-on-mutating-body rejection — and every current `@action-origin-exempt` sits on a genuine read-only getter or the documented anonymous surface. Not a finding |
| 5 | HDR `is_hdr`/`transfer_function` leaks to a public surface | **Double-gated.** Omitted from `publicSelectFields` (`data.ts:334,337`) AND `publicMapSelectFields` (`:373,376`), so the field is `undefined` on any public path; every UI badge additionally gates on `isAdmin && isHdr` (`color-details-section.tsx:523`, `lightbox-color-pip.tsx:149`, `info-bottom-sheet.tsx:277`). Defense-in-depth documented at `color-details-section.tsx:512-519`. Not a finding |

My instinct that the backfill walk-back was the cycle's concentration of regression risk was directionally right (it is the only net-new logic), but the implementation is correct and well-tested.

---

## The 5 cycle-4 fixes — re-verified correct AND complete at HEAD

| Commit | Finding | Verification |
|---|---|---|
| `24159f36` | AGG-C4-05 switch comment drift | `switch.tsx:14-15` now cites `translate-x-full` matching code `:50` and inline note `:42-45`. Self-contradiction gone |
| `9a262e3f` | AGG-C4-02 switch geometry test | `switch-geometry-contract.test.ts` pins the triple (w-11+px-0.5+h-6 / size-5 / translate-x-full), proven non-vacuous; passes |
| `6ab40644` | AGG-C4-01 image-queue flake | `image-queue-bootstrap.test.ts:172` now `{ timeout: 20_000, interval: 25 }` + keys on `bootstrapped===true`. R4C1 pattern applied. Passes |
| `1fd350be` | AGG-C4-03 + AGG-C4-04 backfill | `computeBackfillExitCode` + `countDeletedMidReencodeDetectionFailures` extracted, unit-tested (matrix + overlap), wired in `flushBatch:454-455`/`main:527`; ordering assumption verified sound |

## Critical Findings
None.

## Major Findings
None.

## Minor Findings
None. (The cycle-4 MINOR — switch comment drift — is CLOSED at `24159f36`.)

---

## Invariant challenge results (the core of this review)

### 1. Privacy compile-time guards — HOLDS
`PrivacySensitiveKeys` is the single canonical union (`data.ts:416`). `_SensitiveKeysInPublic = Extract<keyof publicSelectFields, PrivacySensitiveKeys>` fires a TS error if any sensitive key lands in the public select (`:418-419`). The map guard auto-derives `Exclude<PrivacySensitiveKeys,'latitude'|'longitude'>` so new sensitive keys are guarded for free (`:429-431`). The `_largePayloadGuard` (`:447-450`) catches `blur_data_url` re-add regardless of alias. Backed at runtime by `privacy-fields.test.ts`'s SYMMETRIC contract (admin-only keys === SENSITIVE_KEYS exactly, `:83`). typecheck EXIT 0 confirms all three guards green. The only residual is the *structural* nature (per-select-object, not a global "no PII in any response" invariant) — already noted by the prior critic as a latent risk, not a HEAD defect, and the one public ad-hoc select stays clean (prediction #3).

### 2. action-origin / api-auth lint gates — HOLDS (no exploitable false-negative)
- **api-auth** (`check-api-auth.ts`): named re-exports of HTTP methods → hard-fail (`:108`); function/class-declaration handler exports → hard-fail (`:133`); variable exports must be `withAdminAuth(...)` with as/satisfies/paren unwrap (`:64-73`); zero handler exports → hard-fail (`:138`). Covers `route.{ts,tsx,js,mjs,cjs}`.
- **action-origin** (`check-action-origin.ts`): recursive discovery (`walkForActionFiles`); aliased exports → hard-fail (`:319`); exempt-comment-on-mutating-body → hard-fail (`:289-292`); pre-guard mutation → reject (`:238`); guard must be variable-bound AND early-returned at top-level body (`:223-252`). Bare/ignored guard result rejected.
- **Narrow theoretical gap (NOT a finding):** an action that mutates ONLY via filesystem (no Drizzle call in `MUTATING_METHOD_NAMES`/`MUTATING_FUNCTION_NAMES`) could carry a false `@action-origin-exempt` and pass — because `nodeContainsMutatingCall` only detects DB mutations + 3 named fns. But (a) the gate still FAILS any unguarded export without an exempt comment regardless of mutation type, so this is not a guard *bypass*, only a wrongly-allowed exemption; (b) it requires deliberate misuse; (c) zero current exemptions sit on fs-mutating actions (all 4 internal exemptions are genuine read-only getters; `public.ts` is excluded by basename anyway). Defense-in-depth-of-defense-in-depth; not worth a code change at convergence.

### 3. Migration journal-hash post-condition — HOLDS (fails loud)
`runMigrations` post-conditions every journal hash against `__drizzle_migrations` and `throw new Error("Drizzle silently skipped N migration(s): …")` on any miss (`migrate.js:709-718`). The throw is reachable (not dead-computed), and the journal IS non-monotonic exactly as CLAUDE.md documents, so the protection is real and live.

### 4. Advisory-lock serialization — HOLDS (no deadlock possible)
Two nested acquisitions exist:
- `DB_RESTORE`(0s) → `UPLOAD_PROCESSING_CONTRACT`(0s) (`db-actions.ts:290→302`)
- `COLOR_PIPELINE_BACKFILL`(0s) → `image-processing:{id}`(0s) (`admin-backfill-runner.ts:310→347`)
**Both INNER acquisitions are non-blocking (`GET_LOCK(name, 0)`).** A deadlock cycle requires at least one party to BLOCK while holding a lock; with a 0s inner timeout the outer holder bails immediately on contention (db-actions.ts:303-307 releases and returns `restoreInProgress`; backfill skips the row). No reverse pairing exists: uploads acquire ONLY the contract lock (never then `DB_RESTORE`); the image-queue acquires ONLY the per-image claim (never then the backfill lock). The only blocking acquisitions (5-10s) are single-lock, top-level, and bounded — no indefinite stall. Releases are guaranteed (dedicated connections, finally blocks, connection-close fallback). The non-acquired-claim path releases its connection (`:357`) — no FD leak.

### 5. ETag / cache invalidation consistency — HOLDS
serve-upload path: `W/"v${VERSION}-${mtimeMs}-${size}-${settingsHash}"` + `public, max-age=3600, must-revalidate` (`serve-upload.ts:215,230,252`). Static path: same `public, max-age=3600, must-revalidate`, NO ETag override → Next's mtime+size weak ETag (`next.config.ts:71`). Both deliberately NOT `immutable` because backfill rewrites bytes in place under unchanged filenames (documented `next.config.ts:64-66`). `COLOR_IMPACTING_KEYS` = exactly 5 (`settings-hash.ts:41-47`), `HASH_LENGTH=8`, single `.slice(0,8)` at the hash site only — matches CLAUDE.md's "all 5 COLOR_IMPACTING_KEYS". Consistent across serve-upload, next.config, and the documented backfill-reencode invalidation story.

### 6. HDR honesty (is_hdr admin-only until WI-09) — HOLDS
See prediction #5. Data-layer omission + UI `isAdmin && isHdr` double gate. The honesty rule is enforced structurally (the field never reaches a public component) AND defensively (badge gated even if a future feature surfaced the field).

---

## What's Missing (gaps probed, came up clean)
- **Backfill underflow / negative counter:** probed — cannot occur (prediction #2).
- **Backfill ordering coupling:** probed — `slice(items.length)` is exact, not coincidental (prediction #1). The sole coupling (derivative items pushed after success items) is local to one function and self-documented at `:451-453`.
- **Public ad-hoc selects beyond the canonical guard:** swept all `db.select`/`tx.select` outside data.ts/data-timeline.ts — only `id`/`topic`/`slug`/`share_key`/`processed`-style scalar selects plus the public-safe semantic enrichment. No raw-PII public select.
- **Lint-gate escape hatches:** the only theoretical one (fs-mutating false exemption) requires deliberate misuse and has no instance at HEAD.

## Ambiguity Risks
None. The reviewed diffs are unambiguous and self-documented.

## Multi-Perspective Notes
- **Skeptic (strongest argument the system is wrong):** The backfill walk-back is the only place a subtle accounting bug could hide. I traced the `updateResults` build order, the slice boundary, and the per-batch subtraction bound — the skeptic's best case (negative counter / wrong slice / double-count) collapses under direct read. The geometry test and flake fix are mechanical and verified.
- **Executor:** Every cycle-4 fix is self-contained and re-derivable from its commit + cited line. No missing handoffs.
- **Stakeholder:** The cycle closed real items (gate-trust flake, two regression-test gaps, a bounded LOW accounting edge, a zero-impact comment) without scope creep. HARD GUARD honored — no agent or fix touched CLIP activation; I critiqued the semantic-route select shape (clean) without flagging "CLIP is disabled."

## Verdict Justification
ACCEPT. The five prior-cycle fixes are each functionally correct AND complete (no symptom-only patch, no dangling reference, no broken gate). The six challenged whole-system invariants — privacy compile-time guards, action-origin/api-auth lint airtightness, migration fail-loud post-condition, advisory-lock non-deadlock serialization, ETag/cache consistency, HDR honesty — all hold under adversarial pressure-testing against actual code, and CLAUDE.md describes each honestly. Build is fully green at HEAD (68 changed+guard tests pass, typecheck EXIT 0, all 3 security lint gates pass). No Realist Check downgrade was needed because nothing was inflated to begin with — I found nothing to rate. No escalation to ADVERSARIAL mode was triggered (zero CRITICAL, zero MAJOR). This is honest convergence.

**For an upgrade beyond ACCEPT:** nothing required. The system is at a clean convergence point from the whole-system invariant angle.

## Open Questions (unscored)
- The privacy guard remains *structural* (per-select-object), not a global "no PII in any public response" invariant. The deferred register already tracks a possible lint rule for ad-hoc public `db.select` with raw `images.<col>` references. Speculative net-new infrastructure, not a defect; carried as-is.
- The action-origin scanner's mutation-category set (`MUTATING_METHOD_NAMES`/`MUTATING_FUNCTION_NAMES`) would not flag a hypothetical fs-only mutating action wrongly carrying an exempt comment. Net-new hardening, not a HEAD defect; not scheduled.

---
*Ralplan summary row:* N/A — this is a code/invariant review, not a ralplan consensus-planning artifact.
