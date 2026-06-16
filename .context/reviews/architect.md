# Deep Architecture & Design-Risk Review — GalleryKit (Cycle 2)

**Reviewer:** architect (read-only) · **HEAD:** 8ccc8806 · **Date:** 2026-06-16
**Scope calibration:** explicitly single-instance / single-writer / personal-scale self-hosted product. Findings are weighted against that scope — structural risks that matter even at personal scale are separated from horizontal-scale concerns the docs already fence.

---

## Method & What Was Mapped

1. **Layering / dependency direction** — grepped every `lib → app` import, every `api → actions` import, every `'use client'` → `server-only` transitive edge, and the public/admin data-access split.
2. **Coordination-state inventory** — enumerated every module-level mutable Map/Set/let, every `globalThis[Symbol.for(...)]` store, and every Promise-singleton, then cross-checked each against CLAUDE.md's "don't horizontally scale" fence.
3. **Extensibility surfaces** — storage abstraction, color-pipeline decision matrix, settings/config system, i18n surface.
4. **Enforcement model** — whether security/privacy invariants hold *by construction* (types/lint/tests fail on violation) vs *by convention* (a careful reader must remember).

**Headline:** This is an unusually mature, heavily test-fortified codebase. Layering is clean, the privacy boundary is genuinely enforced by construction, and almost every process-local state risk is both deliberate and fenced. The real architectural debt is **concentration of complexity in a few 1000+ LOC modules**, a **triple-mirrored privacy field surface**, **config sprawl across 40+ env vars with no central typed module**, and an **orphaned storage abstraction** that is honest about being orphaned. None of these are emergencies at the stated scope.

---

## Severity: HIGH (structural risk worth addressing even at personal scale)

### ARCH-01 — `lib/data.ts` is a 1,649-line god-module spanning the entire data layer · Confidence: High

`apps/web/src/lib/data.ts` (1,649 lines) holds: the public/admin/map select-field derivation + compile-time privacy guards (lines ~204–410), the shared-group **view-count buffer with crash-resilient async flush** (lines 14–~180), `tagNamesAgg`, and ~28 query functions (9 `cache()`-wrapped). It is imported by 28 modules.

- **Design risk:** Three unrelated responsibilities live in one file: (a) privacy-critical field-set definitions, (b) a stateful background-flush subsystem (mutable Maps, timers, backoff, retry caps), and (c) the read query catalog. The view-count buffer alone is a self-contained eventual-consistency subsystem (`viewCountBuffer`, `viewCountRetryCount`, `consecutiveFlushFailures`, `flushGroupViewCounts`, chunked drains, exponential backoff) that has nothing to do with "data access" yet shares a file with the privacy guards.
- **Future-pain scenario:** A future change to view-count flushing forces a reviewer to re-read 1,649 lines that include the privacy-sensitive select sets; conversely, a privacy-field edit risks merge collisions with unrelated flush-tuning commits. The file's size already required a de-flaking timeout bump in the boundary test (`client-server-only-boundary.test.ts` AGG-R8-01) because of how much it pulls in.
- **Remediation:** Extract the view-count buffer subsystem into `lib/shared-group-view-counter.ts` (state + flush + shutdown flush), re-exported for back-compat. Optionally split the select-field definitions into `lib/select-fields.ts`. The privacy guards should travel with the field definitions. **Worth doing now** — low-risk mechanical extraction, high clarity payoff, and it shrinks the privacy blast radius.

### ARCH-02 — Privacy field set is mirrored in **three** places; correctness rests on a hand-maintained `SENSITIVE_KEYS` literal · Confidence: High

The public/admin field separation is enforced in `lib/data.ts` (`adminSelectFields` → destructured `_omit*` → `publicSelectFields` + `publicMapSelectFields`), mirrored again in `lib/data-timeline.ts` (`timelineSelectFields`, its own `Extract<…, PrivacySensitiveKeys>` guard), and pinned by the `SENSITIVE_KEYS` literal in `__tests__/privacy-fields.test.ts`.

- **What's genuinely by-construction (good):** The `_privacyGuard` (`data.ts` ~408) is a compile-time `Extract` that fails the build if a *known* sensitive key lands in `publicSelectFields`. The **symmetric guard test** (`privacy-fields.test.ts:83`, "admin-only keys form exactly the SENSITIVE_KEYS contract") asserts `setDifference(adminSelectFieldKeys, publicSelectFieldKeys) === SENSITIVE_KEYS`. Together these mean a new admin-only column added to `adminSelectFields` *without* a privacy decision fails CI loudly. This is a real by-construction win and should be preserved.
- **Residual design risk:** Three parallel field surfaces (`data.ts` public, `data.ts` map, `data-timeline.ts` timeline) must each independently omit every sensitive key. The map surface is the dangerous one — it *intentionally re-adds* `latitude`/`longitude` and relies entirely on a `map_visible` JOIN, with safety living in a comment ("DO NOT use this field set without the map_visible topic filter"), not in the type. A fourth public read path added by a future contributor inherits none of these guards unless they remember to add the `Extract` guard + extend the subset test.
- **Failure scenario:** Someone adds `lib/data-search.ts` (or a new API route) that hand-writes a select, copies the "safe" columns from memory, and forgets one admin-only column → silent PII/internal-metadata leak with no failing test, because the symmetric guard only inspects `data.ts`'s `adminSelectFields`/`publicSelectFields`, not arbitrary new selects.
- **Remediation:** (a) Provide a single exported `PUBLIC_IMAGE_COLUMNS` allowlist that all public reads MUST spread, so new read paths are safe by default; (b) bind the map-visibility coupling into a single `getMapImages`-only helper so `publicMapSelectFields` cannot be referenced elsewhere (it currently can). **Worth doing now** — privacy is the product's most expensive-to-reverse invariant.

### ARCH-03 — Complexity concentration in the Sharp pipeline + image action (`process-image.ts` 1,638 LOC, `actions/images.ts` 1,152 LOC) · Confidence: High

`lib/process-image.ts` (1,638) owns: directory bootstrap, the AVIF/WebP/JPEG parallel encode matrix, the rgb16 wide-gamut path, the 10-bit AVIF libheif probe, blur generation, GPS/EXIF stripping calls, hardlink/copy dedup, and ~30 direct `fs` call sites. `actions/images.ts` (1,152) owns upload validation, quota tracking, enqueue, and delete/cleanup. These two files concentrate most of the product's irreversible on-disk behavior.

- **Design risk:** The encoder decision matrix (documented in CLAUDE.md as a 7-row table) is expressed imperatively across `process-image.ts` rather than as a data-driven table consumed by a small executor. Adding an 8th source-profile case (or the deferred HDR `_hdr.avif` path WI-09) means editing deep inside a 1,600-line function family. The 30 fs call sites are also exactly what ARCH-05 (storage) would have to reroute.
- **Future-pain scenario:** WI-09 (HDR encoder shell-out) lands → the contributor must thread a new branch through `processImageFormats`, the probe singleton, the dedup logic, and the variant-cleanup unlink set, with the blast radius spanning both 1,600-line files. Regression risk is high precisely because so much shares one scope.
- **Remediation:** Promote the source→decision mapping to a declarative table (`COLOR_PIPELINE_MATRIX`) and reduce `processImageFormats` to a thin executor over it; extract the fs-mutation/dedup/cleanup helpers into `lib/derivative-files.ts`. This *also* makes ARCH-05 tractable. **Partially now** — the declarative-matrix extraction is worth it before WI-09; full fs extraction can defer until storage work is actually scheduled.

---

## Severity: MEDIUM (acceptable now, will bite if the product grows or contributors multiply)

### ARCH-04 — Configuration sprawl: 40+ env vars read directly, no central typed config module · Confidence: High

Admin-tunable settings have a clean two-stage pipeline (`gallery-config-shared.ts` validation → `gallery-config.ts` DB resolution). **Env-var operational config has no equivalent** — 40+ `process.env.X` reads scattered across 25+ files (`db/index.ts`, `lib/upload-paths.ts`, `lib/rate-limit.ts`, `lib/request-origin.ts`, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/admin-backfill-runner.ts`, `instrumentation.ts`, scripts, …).

- **Concrete issues found:**
  - **Duplicate-name redundancy:** `ADMIN_BACKFILL_CONCURRENCY` (`admin-backfill-runner.ts`) and `BACKFILL_CONCURRENCY` (`scripts/backfill-color-pipeline.ts`) tune the *same conceptual* parallelism under two names — an operator who sets one and not the other gets surprising behavior across the in-app vs sidecar entry points (which CLAUDE.md presents as "equivalent").
  - **Four independent concurrency knobs** (`QUEUE_CONCURRENCY`, `SHARP_CONCURRENCY`, `IMAGE_CLEANUP_CONCURRENCY`, `ADMIN_BACKFILL_CONCURRENCY`) with documented-but-scattered interdependencies and no single place to reason about total CPU pressure.
  - **`TRUST_PROXY` / `TRUSTED_PROXY_HOPS`** (security-critical for client-IP trust in rate limiting) are read in `rate-limit.ts` and `request-origin.ts` with no central validation — a misconfiguration silently changes the IP-trust posture.
  - **Asymmetric tunability:** upload *window/count* caps are env-tunable but per-file size caps (`MAX_UPLOAD_FILE_BYTES` 200 MiB, `MAX_RESTORE_FILE_BYTES` 250 MiB) are hardcoded; rate-limit windows/maxes are 100% hardcoded in `rate-limit.ts`.
- **Design risk:** No typed `env.ts` means no fail-fast validation at boot (a typo in `DB_SSL` or `TRUSTED_PROXY_HOPS` surfaces as runtime behavior, not a startup error), and the true configuration contract is only discoverable by grep.
- **Remediation:** Introduce a single `lib/env.ts` that reads + validates every env var once at startup (zod or hand-rolled), exports a typed frozen object, and is the only module allowed to touch `process.env`. Collapse `BACKFILL_CONCURRENCY`/`ADMIN_BACKFILL_CONCURRENCY` to one name with a back-compat alias. **Defer-but-soon** — not urgent for a single operator, but cheap insurance against a security-relevant proxy misconfig and a real onboarding aid.

### ARCH-05 — Storage abstraction is a fully orphaned shell (honestly documented) · Confidence: High

`lib/storage/{types.ts (105), local.ts (139), index.ts (146)}` defines a clean `StorageBackend` interface + `LocalStorageBackend` + a singleton with `switchStorageBackend`. **Zero production importers** — the only importer is `__tests__/storage-local.test.ts`. Meanwhile the live pipeline does ~49 direct `fs` calls across `process-image.ts`, `serve-upload.ts`, `download/[imageId]/route.ts`, `upload-paths.ts`, `image-queue.ts`. `switchStorageBackend`'s type union is `'local'` only, so it can only ever switch local→local — genuinely dead code.

- **Why this is only MEDIUM:** CLAUDE.md and the module's own header are *explicit* that it is not wired, and `types.ts:4-15` warns docs must stay aligned. The honesty defuses the classic "abstraction implies capability" trap. No admin UI exposes a backend switch.
- **Residual design risk:** A dead abstraction tends to **drift** from the real fs code it's meant to model. The interface (`writeStream`/`writeBuffer`/`copy`/`getUrl`) was designed before the pipeline grew its hardlink-dedup + TOCTOU-safe symlink-rejection serving semantics — so if someone *does* try to wire it, the interface is already an imperfect fit (no hardlink/atomic-rename/`realpath`-revalidation primitives), and they'll discover that only mid-migration. There's also a small ongoing cost: every reader who finds it must reconfirm it's inert.
- **Remediation:** Either (a) **delete it** and reintroduce a fit-for-purpose interface when S3 is actually scheduled (recommended at this scope — YAGNI), or (b) keep it but add a one-line `@orphaned` marker test asserting it has no non-test importers so it can't quietly gain a half-wired caller. **Defer** the migration; **decide now** between delete vs mark, because "keep an unused abstraction indefinitely" is the worst option.

### ARCH-06 — `lib/api-auth.ts` imports `isAdmin` from `app/actions/auth` — a `lib → app` dependency inversion · Confidence: Medium

`lib/api-auth.ts:1` does `import { isAdmin } from '@/app/actions/auth'`, and `api/admin/db/download/route.ts:8` imports `getCurrentUser` from the same. This is the only `lib → app` edge in the codebase (verified by grep), so the layering is otherwise clean.

- **Design risk:** `lib/` is supposed to be the lower, app-agnostic layer; depending *upward* into `app/actions/` couples a shared utility to a Next.js server-action module (which carries `'use server'` and a heavy import set: argon2, `next/headers`, rate-limit Maps, audit). This is the kind of edge that creates surprising bundling/circular-import behavior under refactor, and it means the auth *domain* is physically located in the `app/actions/` layer rather than in `lib/`.
- **Why Medium not High:** It works today, the auth logic legitimately needs request context (`cookies()`), and `auth.ts` is effectively a domain module that merely lives under `app/actions/`. The inversion is contained to auth.
- **Remediation:** Move the session/auth *reads* (`getSession`, `getCurrentUser`, `isAdmin`) into `lib/auth.ts` (or `lib/session.ts`, which `auth.ts` already depends on) and have `app/actions/auth.ts` re-export the mutations (`login`/`logout`/`updatePassword`) plus re-export the reads for back-compat. Then `lib/api-auth.ts` imports down into `lib/`, restoring direction. **Defer** unless an auth refactor is already planned — it's a tidiness/robustness fix, not a live bug.

### ARCH-07 — Coordination-state fence in CLAUDE.md is *nearly* complete but its line-194 enumeration is not exhaustive · Confidence: Medium

Inventory of process-local coordination state (would diverge across instances):
| State | File | Fenced at CLAUDE.md:194? | Notes |
|---|---|---|---|
| Image processing queue (`PQueue`, `enqueued` Set, retry/claim Maps, permanently-failed Set) | `image-queue.ts` (globalThis) | ✅ "image queue state" | Recoverable from DB on restart via `processed=false` bootstrap re-scan |
| Upload quota tracker | `upload-tracker-state.ts` (globalThis) | ✅ "upload quota tracking" | |
| Restore-maintenance flag | `restore-maintenance.ts` (globalThis) | ✅ "Restore maintenance flags" | |
| Shared-group **view-count buffer** | `data.ts` (module `let`) | ⚠️ not at :194, but documented elsewhere (Runtime topology: "buffered in process memory") | Best-effort by design |
| **Admin-backfill runner state** (`running`, counts, `lastError`) | `admin-backfill-runner.ts` (globalThis) | ⚠️ not enumerated anywhere | Serialized across instances by the `gallerykit_color_pipeline_backfill` advisory lock, so correctness holds; only the *status surface* is per-process |
| Login/account/password + OG/checkout/share/search/semantic rate-limit Maps | `auth-rate-limit.ts`, `rate-limit.ts` | partial (login has DB backup) | Per-process buckets weaken distributed-brute-force defense if scaled; login bucket has DB fallback, others don't |

- **Design risk:** The fence is *substantively* complete (every correctness-critical store is either named, advisory-locked, or DB-backed), but the canonical single-sentence enumeration at line 194 omits the backfill-runner state and view-count buffer. A future maintainer reading only line 194 might conclude those three named items are the *complete* list of scale-blockers and miss that backfill *status* and rate-limit *effectiveness* also degrade. The advisory-lock cross-tenant caveat (C8R-RPL-06) is already well documented.
- **Remediation:** Extend the line-194 sentence to "...and the admin-backfill runner status, shared-group view-count buffer, and in-memory rate-limit buckets are also process-local (the first two are correctness-fenced by an advisory lock / best-effort-by-design; the rate-limit buckets weaken distributed-attack defense under scale-out)." **Worth doing now** — it's a one-line doc edit that closes a reasoning gap, zero code risk.

---

## Severity: LOW (minor / mostly tidiness)

### ARCH-08 — `app/actions.ts` barrel re-export creates a soft module-boundary ambiguity · Confidence: Medium
`app/actions.ts` (35 lines) re-exports from the 13 `app/actions/*.ts` modules plus pulls client-safe types from `lib/bulk-edit-types.ts`. It's a deliberate, documented back-compat barrel. The mild risk: a barrel makes it easy to import a *server action* into a *client component* by reflex (the type-only `bulk-edit-types` carve-out exists precisely because of this). It's well-managed today (the `'use server'` directive per-module is the real guard), but the barrel slightly obscures which symbols are server-only. **No action needed**; flagged for awareness.

### ARCH-09 — Lint gates encode architecture invariants as regex scanners (powerful but brittle) · Confidence: Medium
The four blocking lint gates (`lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, plus the touch-target audit) enforce real structural invariants by *source-text scanning* with normalizers for multi-line JSX, aliased exports, etc. This is a genuine by-construction win (a new admin route without `withAdminAuth` fails CI). The risk is the scanners themselves are complex regex/AST-lite (the touch-target normalizer rewrites `=>` to `=ARROW` to dodge a lookahead) and have a history of blind spots that shipped violations (multi-line Buttons, `Badge asChild`, native `select`) until a later cycle caught them. They're well-tested via fixtures, but each is a small parser that can drift. **No action needed** — this is the right tradeoff for the team's loop-driven workflow; noted so the planner doesn't treat a scanner gap as a surprise.

### ARCH-10 — i18n surface: intentional en/ko value-shape asymmetry is correct but easy to "fix" wrongly · Confidence: Low
Key parity is enforced between `en.json`/`ko.json`, with deliberately different value shapes (en uses ICU `plural`, ko uses a fixed `{count}장`). This is documented (DOC-R5C3-07) and correct (Korean has no grammatical plural). The only risk is a well-meaning contributor "normalizing" ko to add a `plural` block. Already fenced by docs. **No action needed.**

---

## Scope-Appropriate Tradeoffs (NOT bugs — planner should NOT "fix" these)

These are deliberate, documented decisions correct for a single-instance personal gallery. Do not over-engineer them.

- **Single MySQL + single web instance = SPOF.** Documented (CLAUDE.md "Runtime topology"). All advisory locks (`advisory-locks.ts`: 6 named locks) assume one DB server; the cross-tenant scope caveat is already documented (C8R-RPL-06 / AGG8R-05). Multi-instance HA is explicitly out of scope. **Leave alone.**
- **`revalidate = 0` on all public pages (fully dynamic rendering).** 10 routes opt out of ISR deliberately for immediate freshness after async processing/metadata edits; CLAUDE.md commits to "reintroduce ISR only with an explicit invalidation/freshness plan." This is a *correctness-over-throughput* choice appropriate at personal traffic. **Leave alone** — re-introducing ISR is a feature decision, not a fix.
- **Flat multi-root-admin model (no RBAC).** Verified: zero role/capability checks anywhere — every admin gate is `isAdmin()`. CLAUDE.md states any admin can do everything. This is an accepted product decision; adding RBAC would be net-negative complexity at this scope. **Leave alone.**
- **Process-local rate-limit buckets.** Per-process by design; login bucket has a DB backup for the distributed case. Acceptable at single-instance scope. **Leave alone** unless scaling out (see ARCH-07).
- **View-count is best-effort approximate analytics.** Buffered in memory, async flush, drops on sustained outage — explicitly "not billing/audit-grade." Correct tradeoff. **Leave alone.**
- **Cache-Control `must-revalidate` (not `immutable`) on derivatives.** Deliberate (R4C6 ARCH-R4C6-06) because backfill rewrites bytes under unchanged filenames. **Leave alone.**
- **Per-iteration deploy with no staging.** Documented operational policy. Out of architectural scope.
- **Hardcoded rate-limit windows / file-size caps.** Acceptable for a single operator; making them env-tunable is a nice-to-have (folds into ARCH-04), not a defect.

---

## What's Genuinely Well-Architected (so the planner doesn't churn it)

- **Privacy boundary is by construction**, not convention: compile-time `Extract` guard + symmetric set-difference test (ARCH-02 covers the residual mirror risk, but the core is solid).
- **Layering is clean**: no `lib → app` edges except the one contained auth inversion (ARCH-06); no `api` route duplicates action business logic; client→server-only boundary is transitively test-pinned.
- **Queue recovery is robust**: DB is the source of truth; restart re-scans `processed=false`, with claim-retry caps and a permanently-failed set to prevent infinite loops; graceful SIGTERM/SIGINT drains queue + flushes view counts within 15s.
- **Smart-collections dynamic query builder is safe by construction**: pure Drizzle parameter binding, AST node-type validation, column allowlist, depth cap, IN-value cap — no string concatenation.
- **Crash-resilient view-count flush**: atomic Map swap, chunked drains, exponential backoff, retry caps — genuinely careful eventual-consistency engineering (it just lives in the wrong file — ARCH-01).
- **Advisory locks centralized** in `advisory-locks.ts` with named constants and a documented server-scope caveat.

---

## TOP 3 STRUCTURAL RISKS

1. **ARCH-02 — Triple-mirrored privacy field surface.** The core public/admin split is by-construction-safe, but three parallel select surfaces (public, map, timeline) + the map surface's comment-only `map_visible` coupling mean a *fourth* future read path inherits no guard. Privacy is the most expensive-to-reverse invariant; give new read paths a single safe-by-default `PUBLIC_IMAGE_COLUMNS` allowlist and lock the map field set behind its only legitimate caller.

2. **ARCH-01 / ARCH-03 — Complexity concentration in `data.ts` (1,649), `process-image.ts` (1,638), `actions/images.ts` (1,152).** Unrelated concerns share huge scopes (privacy guards + view-count subsystem in one file; the entire encoder decision matrix expressed imperatively in another). This raises regression risk for the next pipeline change (esp. the deferred HDR WI-09) and inflates the privacy blast radius. Extract the view-count subsystem and promote the color-pipeline matrix to a declarative table.

3. **ARCH-04 — Config sprawl with no central typed env module.** 40+ scattered `process.env` reads, duplicate-name concurrency knobs (`BACKFILL_CONCURRENCY` vs `ADMIN_BACKFILL_CONCURRENCY`), and security-relevant proxy-trust vars (`TRUST_PROXY`/`TRUSTED_PROXY_HOPS`) read without central validation or boot-time fail-fast. A single typed `lib/env.ts` would catch misconfigurations at startup instead of as silent runtime behavior changes.
