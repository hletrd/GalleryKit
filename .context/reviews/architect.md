# Architect Review — GalleryKit

**Run 6 / Cycle 4 · HEAD `f8147868`**
**Date:** 2026-06-16
**Scope:** Architectural & design-risk review of `apps/web/src` — module boundaries, coupling, layering violations, abstraction leaks, client/server boundary safety, shared-mutable-state / temporal coupling. Focus this cycle: (a) verify prior-cycle structural fixes are sound and introduced no new debt, (b) hunt for NEW boundary violations or fragile coupling, (c) confirm the deferred structural items remain bound by CLAUDE.md's documented topology.
**Mode:** READ-ONLY. Verified against current HEAD.

---

## Summary

**The architecture is sound. No NEW findings.** Every cycle-3 structural fix landed correctly and introduced zero new debt, the client/server boundary is clean across all 62 `'use client'` files (zero client→server-only import chains, verified by transitive fan-out), and the only remaining structural items are the four already-deferred ones (AGG-C3-14/15/16/17), each correctly bound by CLAUDE.md's documented single-instance topology and explicit `@/lib/storage` retention decision. This is honest convergence.

The prior-cycle layering trap (AGG-C3-18 / my A6: client-safe `isWideGamutPrimary` imported via the server-only `color-detection` re-export) is **confirmed closed** in `0ef29a10` — the re-export is gone, replaced by an explanatory tombstone comment (`color-detection.ts:46`), the import was repointed to the client-safe leaf (`actions/images.ts:29`), and a NEW wiring test (`wide-gamut-predicate-wiring.test.ts`) now pins all 9 consumers to `@/lib/color-primaries` and fails the build if any ad-hoc wide-gamut comparison creeps back. The fix is not just applied — it is structurally defended against regression. This is the right way to close a layering trap.

---

## Verification of prior-cycle fixes (all SOUND, no new debt)

| Finding | Fix commit | Verdict | Evidence |
|---|---|---|---|
| AGG-C3-18 / A6 — color-detection re-export trap | `0ef29a10` | **CLOSED + regression-pinned** | re-export removed (`color-detection.ts:46` tombstone); import repointed (`actions/images.ts:29` → `@/lib/color-primaries`); `wide-gamut-predicate-wiring.test.ts:43` pins canonical import for all consumers |
| AGG-C3-01 — Switch thumb geometry | `a3b8c557` | **SOUND, clean pattern** | `ui/switch.tsx`: 44px hit area kept on Root (audit passes), nested `aria-hidden` `h-6 w-11` visible pill, width-relative `translate-x-full` (not fixed `translate-x-5`); geometry comment is arithmetically correct |
| AGG-C3-02 — Histogram clip-label contrast | `60c54346` | **SOUND** | `histogram.tsx:671,674` both use `text-destructive-text` token (AA on white); no `text-red-500` remains |
| AGG-C3-04 — Sidecar backfill exit code | `a033056d` | **SOUND** | `backfill-color-pipeline.ts:342` tracks `detectionFailures`, `:485` exits non-zero on `detectionFailures > 0`, `:470` loud WARN summary line |
| AGG-C3-05 — settings-hash stale max-age docstring | `f603cd3f` | **SOUND** | `settings-hash.ts:20-21` now `max-age=3600, must-revalidate` |
| AGG-C3-06 — serve-upload ETag comment re-enumeration | `f603cd3f` | **SOUND** | `serve-upload.ts:197-208` inline 9-key list removed; comment points to `COLOR_IMPACTING_KEYS` as authoritative |
| AGG-C3-07 — Stripe cross-ref label drift | `22d02262` | docs-only, out of architect scope | — |
| AGG-C3-03 — Test-isolation tmpdir | `06a3c5e7` | sound (test infra) | `process-topic-image.ts:36` env override + tmpdir redirect |

**None of these fixes introduced new coupling, new mutable module state, or new boundary crossings.** The Switch fix's nested-element pattern is a textbook way to decouple "tappable hit area" from "visible affordance"; the backfill fix only adds a counter and a summary line; the de-enumeration fix *removes* a duplication source.

---

## Module Map (apps/web/src) — current, verified

```
proxy.ts ............ i18n routing + CSP nonce + admin-cookie presence pre-filter (middleware; real auth lives in actions — deliberate defense-in-depth)
db/ ................. schema.ts (canonical Drizzle schema) · index.ts (pool)
lib/ ................ data access, image pipeline, color/HDR, auth, rate-limit, config, storage(dead, deferred)
  CLIENT-SAFE LEAVES (verified import-free of server deps):
    color-primaries.ts ........... 0 imports — sole source for isWideGamutPrimary/WIDE_GAMUT_PRIMARIES
    color-pipeline-decisions.ts .. 0 imports
    gallery-config-shared.ts ..... 0 imports (validators/consts/types)
    blur-data-url.ts ............. 0 imports
    use-display-capability.ts .... React only
    validation.ts ................ @/lib/constants + @/lib/utils only
    bulk-edit-types.ts ........... shared types (lets client import LICENSE_TIERS without 'use server')
  SERVER-ONLY LEAVES (fs / sharp / mysql2 / @/db):
    data.ts · process-image.ts · color-detection.ts · image-queue.ts ·
    gallery-config.ts (DB resolver; header comment marks it SERVER-ONLY) ·
    serve-upload.ts · admin-backfill-runner.ts · restore-maintenance.ts · auth.ts
app/
  actions.ts ........ barrel: re-exports per-module 'use server' fns + shared TYPES from lib (no raw server-module leak)
  actions/ (14) ..... server actions; every mutating export gates on requireSameOriginAdmin() (lint-enforced)
  api/ (11 routes) .. HTTP-semantics endpoints; admin routes wrap withAdminAuth (lint-enforced)
components/ (62 'use client' + server components like nav.tsx)
scripts/migrate.js .. reconcile + per-entry baseline + loud post-condition
```

---

## Client/server boundary audit — CLEAN

**Transitive import-graph fan-out (62 `'use client'` files):** zero client→server-only chains. Specifically verified:

- **No client component imports a server-only value module.** `@/lib/data`, `@/db`, `@/lib/process-image`, `@/lib/color-detection`, `@/lib/image-queue`, `@/lib/gallery-config` (the DB resolver), `@/lib/serve-upload`, `@/lib/admin-backfill-runner`, `@/lib/restore-maintenance` — none reached by any `'use client'` file's value imports.
- **The only client imports that *name* server modules are `import type`** — `home-client.tsx:13` and `load-more.tsx:6` pull `ImageListCursorInput` from `@/lib/data` as types (erased at compile); `load-more.tsx:5` pulls `LoadMoreImagesResult` type from `@/app/actions/public`. No runtime bundle impact.
- **`nav.tsx` is a Server Component** (`async function Nav()`, no `'use client'`) — correctly fetches `getTopicsCached()` / `getSeoSettings()` / `getGalleryConfig()` server-side and passes only primitives (`navTitle`, `imageSizes`, `semanticSearchMode`) to `<NavClient>`. Proper server→client data hand-off.
- **`@/app/actions` barrel (`actions.ts`) is safe** — each re-exported symbol comes from a module carrying its own `'use server'` directive; shared *types/consts* (`LICENSE_TIERS`, `BulkUpdateImagesInput`) come from the non-server `@/lib/bulk-edit-types`. Client components (`image-manager`, `upload-dropzone`, `search`, etc.) import only action functions (RPC-wrapped by Next), never raw server modules.
- **`gallery-config` split is respected** — every `getGalleryConfig` importer is a server component, server lib, server action, or API route. No `'use client'` file imports the DB resolver; client-side consumers use `gallery-config-shared.ts`.

**No NEW mutable module-level state introduced.** The `let` declarations in recently-touched libs are all the repo's standard bounded patterns: `serve-upload.ts:47-48` (5s-TTL read cache + inflight dedup), `settings-hash.ts:63-64` (same), `process-topic-image.ts:36` (ensureDirs singleton promise). These are convergent read caches, not coordination/writer state — they are not even in the AGG-C3-15 multi-instance concern class.

---

## Deferred structural items — status confirmed, NOT re-reported

Per the cycle-3 deferred register (`plan-353`), these remain bound by CLAUDE.md's documented constraints. I re-confirmed each is unchanged and the deferral reasoning still holds:

- **AGG-C3-14 — `@/lib/storage` dead abstraction (HIGH/struct).** Still 390 LOC, zero importers. CLAUDE.md explicitly retains it ("still exists as an internal abstraction… Do not document or expose S3/MinIO switching until… wired end-to-end"). DEFER stands; exit criterion = wire-or-delete when storage backends become a roadmap item. *(Watch-note unchanged: it re-implements path-containment that also lives in `upload-paths.ts`/`serve-upload.ts` — a divergence trap, not an active defect.)*
- **AGG-C3-15 — restore-maintenance flag process-local while restore lock server-scoped (HIGH→bounded).** Unchanged. CLAUDE.md documents single-web-instance / single-writer topology as an explicit design constraint; critic confirmed the server-scoped `LOCK_UPLOAD_PROCESSING_CONTRACT` *blocks* (not corrupts) a 2nd instance's writes during a restore. DEFER stands; exit criterion = add a startup single-instance advisory lock IF horizontal scaling is attempted. *(My cycle-3 recommendation A2#1 — a cheap startup `GET_LOCK('gallerykit_single_instance', 0)` guardrail — remains the right cheap hardening if/when scaling is on the table, but it is NOT required at one instance and is correctly deferred.)*
- **AGG-C3-16 — `reconcileLegacySchema` hand-maintained mirror (MED/struct).** Unchanged. Migration machinery is robust (loud post-condition on journal hashes); residual gap (mirror forgets a column, invisible on fresh/CI DBs) is documented in `migrate-reconcile-coverage.test.ts` and mitigated by a name-only tripwire. DEFER stands; exit criterion = schema-parity test at the next schema migration.
- **AGG-C3-17 — `actions/images.ts` god-action + LR-route duplication (MED/struct).** `images.ts` still 1157 LOC; LR route 485 LOC; **neither changed since baseline `b1e9e0da`** (only a 1-line import edit in `images.ts`), so no NEW divergence was introduced this cycle. Important nuance: the *per-file processing core* is ALREADY shared — both paths import `saveOriginalAndGetMetadata`/`extractExifForDb`/`stripGpsFromOriginal`/`IMAGE_PIPELINE_VERSION`/`RawFileError` from `process-image.ts` and `isRestoreMaintenanceActive` from `restore-maintenance.ts`. What's duplicated is the *orchestration sequence* (auth → maintenance gate → tracker claim → per-file loop → enqueue → settle), not the leaf operations. DEFER stands; exit criterion = extract `lib/upload-orchestration.ts` when the upload pipeline next needs a change touching both call sites.

**HARD GUARD honored:** No proposal to activate CLIP semantic search anywhere in this review.

---

## Findings

**None.** No new layering violation, no new abstraction leak, no new shared-mutable-state or temporal-coupling risk, no new god-module growth, no client-bundle-bloat risk. The four deferred structural items above are the complete remaining structural surface and are correctly deferred under documented repo rules.

---

## Recommendations

No action required this cycle for architectural/design-risk reasons. The standing (deferred) recommendations from cycle 3 are unchanged and remain correctly gated on their exit criteria:

1. *(deferred)* Delete-or-wire `@/lib/storage` when storage backends become a roadmap item (AGG-C3-14).
2. *(deferred)* Startup single-instance advisory lock IF horizontal scaling is attempted (AGG-C3-15).
3. *(deferred)* Schema-parity test for `reconcileLegacySchema` at the next schema migration (AGG-C3-16).
4. *(deferred)* Extract `lib/upload-orchestration.ts` when the next behavioral change touches both upload paths (AGG-C3-17).

---

## Trade-offs

| Decision | Pros | Cons |
|----------|------|------|
| Keep deferring the 4 structural items (honest convergence) | Avoids high-blast-radius refactors of the most security-sensitive flow (uploads) absent a behavioral driver; respects documented topology; git preserves `@/lib/storage` for resurrection | Triple-entry schema maintenance and dead-abstraction navigation tax persist; the divergence traps (storage path-containment, reconcile mirror, upload-orchestration) stay latent |
| Pre-emptively refactor now anyway | Pays down latent risk before the next change | Net-negative this cycle — introduces regression risk into uploads/migrations with no behavioral need, against CLAUDE.md's explicit retention/topology decisions. Not justified. |

The deferred posture is the correct one: each item has a concrete, sensible exit criterion and none is a correctness/security/data-loss defect at HEAD.

---

## References

- `apps/web/src/lib/color-detection.ts:46` — tombstone comment where the client-safe re-export was removed (AGG-C3-18 closed)
- `apps/web/src/app/actions/images.ts:29` — `isWideGamutPrimary` now imported from `@/lib/color-primaries` (client-safe leaf)
- `apps/web/src/__tests__/wide-gamut-predicate-wiring.test.ts:43,88` — canonical-import regex pins all consumers + bans ad-hoc comparisons (regression defense)
- `apps/web/src/components/ui/switch.tsx:21-25,38-46` — 44px Root hit area + nested aria-hidden visible pill + width-relative `translate-x-full` (AGG-C3-01 sound)
- `apps/web/src/components/histogram.tsx:671,674` — `text-destructive-text` AA token on both clip labels (AGG-C3-02 sound)
- `apps/web/scripts/backfill-color-pipeline.ts:342,464,470,485` — `detectionFailures` tracked, summarized, and surfaced in non-zero exit (AGG-C3-04 sound)
- `apps/web/src/lib/settings-hash.ts:20-21,41,67,96` — `max-age=3600` docstring fixed; `COLOR_IMPACTING_KEYS` single source consumed at hash + DB-query sites (AGG-C3-05/06 sound)
- `apps/web/src/lib/serve-upload.ts:197-208` — ETag comment de-enumerated, points to `COLOR_IMPACTING_KEYS` (AGG-C3-06 sound)
- `apps/web/src/components/nav.tsx:6-12` — Server Component fetching server data, passing primitives to `<NavClient>` (clean server→client hand-off)
- `apps/web/src/app/actions.ts:1-40` — barrel re-exports per-module `'use server'` fns + shared types from `@/lib/bulk-edit-types` (no raw server-module leak)
- `apps/web/src/lib/gallery-config.ts:1-20` — header marks module SERVER-ONLY; every importer verified non-client
- `apps/web/src/lib/color-primaries.ts` / `color-pipeline-decisions.ts` / `gallery-config-shared.ts` / `blur-data-url.ts` — verified import-free of server deps (client-safe leaves)
- `apps/web/src/app/actions/images.ts` (1157 LOC) + `apps/web/src/app/api/admin/lr/upload/route.ts` (485 LOC) — unchanged since baseline `b1e9e0da`; share the per-file processing core from `process-image.ts`/`restore-maintenance.ts`; only orchestration sequence duplicated (AGG-C3-17 deferral stable)
- `apps/web/src/lib/serve-upload.ts:46-48`, `settings-hash.ts:63-64`, `process-topic-image.ts:36` — bounded read-cache / inflight-dedup / singleton-promise patterns (no new coordination state)
