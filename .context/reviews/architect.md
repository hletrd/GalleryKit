# Cycle 13 — Architecture / Design-Risk Review (READ-ONLY)

**Date:** 2026-06-27 · **HEAD:** `80145992` (post cycle-12 fixes) · **Reviewer:** architect
**Scope:** module boundaries, coupling/cohesion, layering invariants, shared-state topology, extensibility traps, structural debt across the whole repo (`apps/web`).

---

## Summary

The codebase is structurally healthy and *getting healthier*. The 30 commits since cycle 11 are **all point-hardening** (timer hygiene, shutdown exit, partial reads, guard strengthening) — **zero new modules, zero new feature surfaces, no new architectural drift** introduced. The core processing DAG (`process-image → image-queue → actions`) is clean and **acyclic**; the read layer (`data.ts`) is a separate leaf. The layering invariants the prompt asked me to audit (client-safe/server-only, public vs admin field sets, color-primaries split) are **genuinely enforced by automated gates + compile-time guards, not merely convention** — this is a real strength (detail in R13-ARCH-09).

What remains is the previously-catalogued structural debt (god-modules, dead `lib/storage`, manual shutdown wiring) plus **two newly-framed risks**: an accumulating "deferred-feature scaffolding" category (R13-ARCH-01/02), and the one genuinely new honesty/expectations gap — the caption stub wired to a public surface (R13-ARCH-01). The high-value deliverable this cycle is a **prioritized, lowest-risk paydown order** for the known-deferred debt (R13-ARCH-10), because the cheapest moment to install a shutdown registry and slice the first god-module seam is *now*, while only two in-memory buffers exist.

| ID | Severity | NEW / Deferred | One-line |
|----|----------|----------------|----------|
| R13-ARCH-01 | LOW (→MED if enabled) | **NEW** | Caption *stub* feeds a PUBLIC alt/title fallback under a "Florence-2 AI" banner; no honesty guard |
| R13-ARCH-02 | LOW | **NEW framing** | "Deferred-feature scaffolding" is accumulating (storage/, hdr-filenames, caption-generator) with no quarantine policy |
| R13-ARCH-03 | LOW | known-deferred | `data.ts` god-module (1670 LOC, 43 exports, 22 importers) mixes read-layer + process-local buffer state |
| R13-ARCH-04 | LOW | known-deferred | Shutdown drain is hand-wired in `instrumentation.ts`; no registry → each new buffer must be manually remembered |
| R13-ARCH-05 | LOW | known-deferred | `lib/storage/*` dead abstraction (3 files, ~13 KB, 1 globalThis singleton, 0 prod importers) |
| R13-ARCH-06 | LOW | known-deferred | `processImageFormats` / `uploadImages` god-functions |
| R13-ARCH-07 | LOW (latent) | known | Client→server-only boundary test leans on a `mysql2`-in-closure heuristic; data layer carries no `server-only` marker |
| R13-ARCH-08 | LOW (latent) | known | `COLOR_IMPACTING_KEYS` compile-guard cannot catch a *forgotten new* byte-impacting setting (author-responsibility seam) |
| R13-ARCH-09 | — (positive) | assessment | Layering invariants are ENFORCED (gates + compile guards + runtime guards), not convention |
| R13-ARCH-10 | — (recommendation) | — | Prioritized debt-paydown order (what to extract first, lowest-risk path) |

---

## Module inventory (boundaries as built)

- **Pipeline (server, leaf):** `lib/process-image.ts` (1705) — pure Sharp pipeline + EXIF + ICC/NCLX bridge. Imports none of the other core modules. 12 exports incl. the `processImageFormats` god-function (~440 LOC, 990-1430) and `saveOriginalAndGetMetadata`.
- **Scheduler (server):** `lib/image-queue.ts` (875) → `process-image`. Owns the `globalThis` queue singleton + per-image advisory-lock claim + caption hook + view-retention GC. Shutdown logic partially extracted to `lib/queue-shutdown.ts` (PROGRESS).
- **Orchestration (server actions):** `app/actions/*` (4619 total) → `process-image` + `image-queue`. `images.ts` (1164) is the `uploadImages` god-action.
- **Read layer (server, leaf):** `lib/data.ts` (1670) → neither queue nor process-image. 43 exports, **22 importers** (highest fan-in module). Also hosts the shared-group view-count buffer (process-local state — cohesion smell).
- **Config split:** `gallery-config-shared.ts` (pure constants/types/validators, **no db imports → client-safe**) vs `gallery-config.ts` (db-backed resolution). Clean split, verified.
- **Color split:** `color-primaries.ts` + `color-pipeline-decisions.ts` (client-safe) vs `color-detection.ts` (server-heavy: HEIF walker, ICC parser, Sharp bridge). Client components import only the client-safe pair. Verified.
- **Rate-limit:** split across `rate-limit.ts` (477: login/search/og/share/semantic) + `auth-rate-limit.ts` (142: account-login/password-change), both on `bounded-map.ts` primitives. `auth-rate-limit` imports `LOGIN_*` constants from `rate-limit` — slightly fuzzy boundary but cohesive enough; not flagged.

**Coupling graph (core):** `process-image` ⟸ `image-queue` ⟸ `actions/images`; `data` independent. **No cycles.** This is the right shape and a notable strength for a codebase this size.

---

## NEW findings

### R13-ARCH-01 — Caption *stub* feeds a PUBLIC fallback under an "AI Florence-2" banner; no honesty guard  [LOW, NEW]
**Files:** `lib/caption-generator.ts:44-65`, `lib/image-queue.ts:456-472`, `lib/photo-title.ts:102-114`, `lib/data.ts:268-269`, `db/schema.ts:82-85`, `lib/gallery-config-shared.ts:39,100,155`.

- `caption-generator.ts` is documented as a **STUB** for US-P52 "Auto alt-text via local Florence-2 ONNX," but the real model is `DEFERRED-FIX`. What actually runs is `generateCaptionStub` → a deterministic EXIF string: `"[stub-prefix]Photo taken with {camera_model}"` or `"[stub-prefix]Photo"`.
- This output is **wired live**: `image-queue.ts:462-468` writes it to `images.alt_text_suggested` whenever the admin setting `auto_alt_text_enabled` is true (default `false`).
- `alt_text_suggested` is in `publicSelectFields` (`data.ts:268-269`, deliberately public) AND is a **public fallback in the photo title/alt chain**: `photo-title.ts:102-114` → `title > tag-derived > alt_text_suggested > generic fallback`. So with the setting on, a tit/tag-less photo's public alt/title becomes `"Photo taken with Canon EOS R5"`.

**Architectural risk / consequence:** an admin who flips `auto_alt_text_enabled` expecting *vision-derived* captions (the module name, `US-P52`, and "Florence-2" comments all advertise that) instead silently ships EXIF-template strings to public SEO/a11y surfaces. The output is *truthful* but not what the feature promises — the same class of expectation gap the HDR pipeline closes with the `_PrivacySensitiveKeys` honesty invariant (`is_hdr` is admin-only "until the bytes fulfill it"). The caption path has **no equivalent guard**: nothing prevents the stub from masquerading as the shipped feature on a public surface.

**Direction:** either (a) keep the stub but rename the admin toggle to reflect reality (e.g. `exif_alt_text_fallback`) and drop the "Florence-2/AI" framing until real inference lands, or (b) gate the *public* consumption (photo-title fallback) behind a `caption_source==='model'` flag so stub output stays an admin-only suggestion, never a public default. Low effort either way.
**Confidence:** High (the wiring is direct and verified end-to-end).

### R13-ARCH-02 — "Deferred-feature scaffolding" is accumulating with no quarantine policy  [LOW, NEW framing]
**Files:** `lib/storage/{index,local,types}.ts`, `lib/hdr-filenames.ts`, `lib/caption-generator.ts`.

Three distinct *not-yet-real* feature stubs now coexist, each individually documented but with **no collective inventory or quarantine convention**:
- `lib/storage/*` — S3/MinIO abstraction, **0 production importers** (only a JSDoc self-reference), carries a live `globalThis` singleton (`index.ts:35`). Pure dead weight.
- `lib/hdr-filenames.ts` — `RESERVED — NOT WIRED` until WI-09.
- `lib/caption-generator.ts` — STUB but *partially wired* (see R13-ARCH-01).

**Risk / consequence:** these three behave differently (dead / reserved-inert / stub-live) but read the same to a future maintainer, so the *live* one (caption) is easy to mistake for inert, and the *dead* one (storage) keeps surfacing every cycle as a "should we delete this?" decision (re-litigated in cycles 10-12). Without a policy, the category grows each time a feature is scaffolded-then-deferred, and reviewers keep re-discovering it.

**Direction:** adopt one convention — a `lib/deferred/` (or `lib/_unwired/`) directory + a one-line table in CLAUDE.md (module → state: dead/reserved/stub-live → exit trigger). Move `storage/*` and `hdr-filenames.ts` there now (subtraction-only, see R13-ARCH-10 step 3); leave `caption-generator` in place but fix R13-ARCH-01 first.
**Confidence:** Medium (framing/policy call, not a defect).

---

## Known-deferred — status + crisp paydown direction

### R13-ARCH-03 — `data.ts` god-module mixes read-layer with process-local buffer state  [LOW, deferred]
**Files:** `lib/data.ts:11-196` (view-count buffer + timers + backoff), 43 exports, 22 importers.
The single highest-fan-in module (22 importers) bundles: field-set/privacy definitions, cursor pagination, ~15 query fns, search, sitemap/map/feed queries, SEO settings — **and** a stateful shared-group view-count buffer with its own `setTimeout` flush, retry caps, and DB-outage backoff (`:11-196`). The buffer is cross-cutting glue (flushed from `instrumentation.ts` shutdown AND `db-actions.ts` pre-backup) that has **nothing to do with read-layer data access**.
**Extraction seam (verified):** `bufferGroupViewCount` is called from exactly one site inside `data.ts` (`getSharedGroup:1275`); `flushBufferedSharedGroupViewCounts` has exactly two external importers (`instrumentation.ts:35`, `db-actions.ts:22`). → Lowest-risk first slice (see R13-ARCH-10).
**Confidence:** High.

### R13-ARCH-04 — Shutdown drain is hand-wired; no lifecycle registry  [LOW, deferred — R12-ARCH-01/02]
**File:** `instrumentation.ts:34-41`. The drain explicitly lists `shutdownImageProcessingQueue()` + `flushBufferedSharedGroupViewCounts()`. Today that set is **complete** (verified: those are the only two `flush*/shutdown*` exports in `lib/`). The trap is purely extensibility: any *future* in-memory buffer (the upload tracker, analytics view batching, a rate-limit DB sync) must be manually remembered here or it silently won't drain on SIGTERM — a data-loss footgun that won't fail any test. The cheapest moment to install a registry is now, with exactly two participants.
**Confidence:** High.

### R13-ARCH-05 — `lib/storage/*` dead abstraction  [LOW, deferred — CLAUDE.md "NOT integrated"]
3 files, ~13 KB, a `globalThis` singleton, **0 production importers**. CLAUDE.md explicitly says S3/MinIO is not integrated and must not be exposed. Pure subtraction candidate (quarantine or delete). Risk of removal: near-zero.

### R13-ARCH-06 — `processImageFormats` / `uploadImages` god-functions  [LOW, deferred]
`process-image.ts:990-1430` (~440 LOC fan-out) and `actions/images.ts` `uploadImages`. Large but cohesive and battle-tested; high-risk to split. Schedule deliberately AFTER the cheap wins; not this cycle.

---

## Layering-invariant enforcement assessment (prompt Q4)

### R13-ARCH-09 — Invariants are ENFORCED by gates/guards, not just convention  [positive]
Verified each claimed boundary has a *mechanical* enforcer, not documentation alone:

| Invariant | Enforcer | Verdict |
|-----------|----------|---------|
| client `'use client'` ↛ `server-only`/`mysql2` | `__tests__/client-server-only-boundary.test.ts` (AST closure walk) | **Enforced** (gap below) |
| public vs admin field sets | `_privacyGuard` + `_mapPrivacyGuard` compile-time (`data.ts:426-439`) + runtime row guard (`getMapImages:1601-1607`) + `privacy-fields.test.ts` fixture | **Strongly enforced** (4 layers) |
| GPS only on map, per-topic opt-in | `publicMapSelectFields` + `innerJoin(map_visible=true)` + `isNotNull(lat/long)` + runtime throw | **Strongly enforced** |
| color-primaries client-safe split | boundary test + convention | **Enforced** |
| `api/admin/**` auth | `lint:api-auth` (CI-blocking) | **Enforced** |
| mutating action same-origin | `lint:action-origin` (CI-blocking) | **Enforced** |
| public mutating route rate-limit | `lint:public-route-rate-limit` (CI-blocking) | **Enforced** |
| color setting → ETag invalidation | `_ColorKeysAreSettingKeys` compile-guard | **Partially** (R13-ARCH-08) |

**Two residual gaps (both LOW, latent):**

- **R13-ARCH-07:** the data/persistence layer carries **no `server-only` marker** (correctly — it's imported under `tsx` by backfill/seed scripts). The boundary test compensates by treating any `mysql2` import in a client closure as server-only-equivalent. This holds *today* because every data path reaches `mysql2` via `@/db`. A future data module that talks to the DB through an *indirection* not statically resolving to `mysql2` (e.g. a thin wrapper, or an ORM re-export) could leak into a client bundle while the test stays green. Direction: when convenient, add an explicit `server-only`-style sentinel the test can key on for `@/lib/data` / `@/lib/gallery-config`, independent of the driver specifier.
- **R13-ARCH-08:** `_ColorKeysAreSettingKeys` (`settings-hash.ts:63-65`) proves every listed key is a real setting, but **cannot** catch a *new* byte-impacting setting the author forgot to list — a valid key is still a valid key. Consequence: a new color/quality/size setting that changes derivative bytes but is omitted from `COLOR_IMPACTING_KEYS` → stale serve-upload-path ETag until backfill. This is author-responsibility per CLAUDE.md; the only mechanical close would be a test asserting every `*_quality_*`/`*_chroma`/`image_sizes`-shaped key appears in the list, which is heuristic. Acceptable as-is; flagged so it isn't mistaken for fully guarded.

---

## R13-ARCH-10 — Prioritized debt-paydown order (lowest-risk first)

For the orchestrator to schedule debt deliberately. Ordered by (risk ascending) then (value):

1. **Install a shutdown/lifecycle registry — DO FIRST.** Add `lib/lifecycle.ts` exposing `onDrain(fn)` + `drainAll(timeoutMs)`; have `image-queue` and the view-count buffer self-register; `instrumentation.ts` calls `drainAll()`. *Why first:* purely additive, wraps the two existing calls, closes R13-ARCH-04 permanently at the cheapest possible moment (two participants), and is the prerequisite that makes step 2 safe. Risk: minimal.
2. **Extract the shared-group view-count buffer out of `data.ts`** → `lib/shared-group-view-buffer.ts` (buffer state + timers + backoff + `bufferGroupViewCount` + `flush*`). `data.ts` imports `bufferGroupViewCount`; the new module self-registers with the step-1 registry; re-point the 2 external importers. *Why second:* verified clean seam (1 internal caller, 2 external), removes the worst cohesion violation in the highest-fan-in module, and pairs naturally with step 1. Risk: low (mechanical move + 3 import edits).
3. **Quarantine `lib/storage/*` (and `hdr-filenames.ts`)** per R13-ARCH-02 → `lib/deferred/`. *Why third:* subtraction-only, 0 prod importers, deletes a stray `globalThis` singleton. Risk: near-zero.
4. **Fix the caption honesty gap (R13-ARCH-01)** — rename the toggle / gate public consumption. Small, but do before any god-function surgery so the public surface is honest.
5. **(Later, deliberate)** split `processImageFormats` (extract per-format encode strategy) and the `data.ts` query groups (listing vs detail vs feed/sitemap vs search). Higher risk; schedule when a feature forces a touch, not speculatively.

---

## Trade-offs

| Option | Pros | Cons |
|--------|------|------|
| Do the cheap extractions (steps 1-3) now | Closes the extensibility trap before a 3rd buffer lands; removes dead surface; near-zero risk | Spends a cycle on non-bug structural work |
| Keep deferring all structure until a feature forces it | Zero churn; single-instance topology means none of this is *currently* breaking | Each new buffer re-rolls the shutdown footgun; storage/ keeps getting re-litigated every cycle; caption gap stays public |
| Quarantine vs delete dead `storage/` | Quarantine preserves the design intent if S3 is ever wired | Delete is cleaner; quarantine still carries a globalThis singleton |

---

## References (file:line — what it shows)
- `lib/caption-generator.ts:44-65` — stub `generateCaption`, EXIF-template output, `autoAltTextEnabled` gate
- `lib/image-queue.ts:456-472` — caption hook writes stub to `alt_text_suggested`
- `lib/photo-title.ts:102-114` — public title/alt fallback consumes `alt_text_suggested`
- `lib/data.ts:11-196` — view-count buffer (process-local state inside the read layer)
- `lib/data.ts:268-269,398-439` — public field set + 4-layer privacy guards (`_privacyGuard`, `_mapPrivacyGuard`)
- `lib/data.ts:1584-1614` — `getMapImages` query-level + runtime GPS guards
- `instrumentation.ts:34-41` — hand-wired shutdown drain (no registry)
- `lib/storage/index.ts:15,35` — dead abstraction, only self-referenced, globalThis singleton
- `lib/queue-shutdown.ts:15-44` — PROGRESS: scheduler shutdown already extracted
- `settings-hash.ts:42-65` — `COLOR_IMPACTING_KEYS` + the partial `_ColorKeysAreSettingKeys` guard
- `lib/color-primaries.ts:1-16` — client-safe split rationale; `gallery-config-shared.ts:1-6` — "no db imports, client-safe"
- `apps/web/package.json:22-24` — the three CI-blocking lint gates
- `__tests__/client-server-only-boundary.test.ts:1-55` — AST boundary test + documented mysql2-heuristic gap
