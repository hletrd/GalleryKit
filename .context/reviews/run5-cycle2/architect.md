# Run-5 Cycle-2 — ARCHITECT lane review

**Angle:** architectural and design risk — layering, coupling, schema/migration integrity, deployment topology, evolution traps.
**Range reviewed:** `b7d4729b..HEAD` (20 cycle-1 commits) plus surrounding architecture.
**Date:** 2026-06-12
**Suppression honored:** plan-315 (MEDIUM), plan-316 (LOW/docs), plan-317 (deferred) — none of their IDs re-reported. In particular ARCH-R5C1-01/-02/-03/-04 and CRT-R5C1-05 (storage `switchStorageBackend` NotImplemented) are already planned and NOT re-raised.

---

## Summary

Migration 0021 (analytics breakdown indexes) followed the repo's own 5-step "Adding a new migration" runbook exactly — verified all three legs of the three-way drift check (drizzle SQL ↔ schema.ts ↔ reconcileLegacySchema), monotonic `when`, and the `runMigrations` post-condition that fails the deploy loudly on any silent skip. The cycle-1 changes are clean: the dead `feature-flags.ts` module was fully removed with no dangling importers, the semantic-search capability gate is correct defense-in-depth across both config and route layers, and the backfill keyset-pagination rewrite terminates correctly and preserves the documented "no version bump on detection failure" resume contract.

Two genuinely new architectural findings emerged, both rooted in cycle-1's CRT-R5C1-02 photo-title fix. The headline is **ARCH-R5C2-02 (HIGH)**: a `'use client'`-reachable module (`photo-title.ts`, imported by 6+ client components) now hard-imports `caption-generator.ts`, a server-side stub whose own documented DEFERRED-FIX is to add `onnxruntime-node` (~150 MB native) + `@/db`. The module is pure today so nothing is broken — but there is no `server-only` guard, so the WI-P52 wiring that lands real inference will silently bloat or break the client bundle. The rest are LOW type-hygiene / behavioral-clarity notes.

---

## Analysis

### 1. Migration 0021 — runbook compliance (verified clean, no finding)

The cycle-1 deliverable migration was audited against all 5 runbook steps:

1. **SQL file** `apps/web/drizzle/0021_analytics_breakdown_indexes.sql:7-8` — two `CREATE INDEX` on `image_views (bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)`. Correct: only `image_views` has `getCountryBreakdown`/`getReferrerBreakdown` queries; topic/shared views deliberately omitted (documented in the SQL header).
2. **Journal entry** `apps/web/drizzle/meta/_journal.json` idx 21, `when = 1781183604120` — **strictly greater** than the prior global max `1779494400001` (0020). Monotonic. ✓
3. **reconcileLegacySchema** `apps/web/scripts/migrate.js:526-530` — both indexes mirrored via idempotent `ensureIndex`, placed immediately AFTER the `image_views` CREATE TABLE block (`:512-524`) and BEFORE `topic_views`, so the table always exists when the index is created. ✓
4. **schema.ts** `apps/web/src/db/schema.ts:232-233` — `idxImageViewsBotViewedCountry` / `idxImageViewsBotViewedReferrer` added to the `imageViews` table builder, referencing real columns (`bot`/`viewed_at`/`country_code`/`referrer_host` all present at `:226-229`). ✓
5. **Privacy guard** — N/A. These are public analytics indexes, not admin-only `images` columns; no `_PrivacySensitiveKeys` / `_omit*` / `SENSITIVE_KEYS` update needed. ✓

Index width sanity: `bot`(1B) + `viewed_at`(4B timestamp) + `referrer_host` varchar(128) utf8mb4 = ~512B max — well under InnoDB's 3072-byte index key limit. No truncation risk.

The `runMigrations` post-condition (`apps/web/scripts/migrate.js:698-715`) recomputes `expectedMigrations` from the full journal and throws if any hash is missing from `__drizzle_migrations`, so 0021 (and every future entry) is covered by the deploy-fails-loud guard. Three-way drift for the older recent migrations 0019 (`uploaded_by` + FK + index) and 0020 (`avif_10bit`) was also re-verified consistent across SQL / schema.ts / reconcile (`migrate.js:375,380,597,612`).

### 2. Module/layer boundaries — `photo-title.ts` → `caption-generator.ts` (FINDING ARCH-R5C2-02)

Cycle-1 commit `130760da` (CRT-R5C1-02) exported `ALT_TEXT_STUB_PREFIX` from `caption-generator.ts:31` and imported it into `photo-title.ts:2`. `photo-title.ts` is imported by `home-client.tsx`, `lightbox.tsx`, `photo-viewer.tsx`, `info-bottom-sheet.tsx`, `tag-filter.tsx` (all `'use client'`), and `on-this-day-widget.tsx`. See finding below.

### 3. Process-local state inventory vs single-writer constraint (no NEW debt)

Full grep of module-level `Map`/singleton/global state in `src/lib/*.ts`: `bounded-map.ts`, `data.ts` (viewCountBuffer), `image-queue.ts` global, `gallery-config.ts`, `settings-hash.ts` cache, `restore-maintenance.ts` global, `serve-upload.ts` servingHashCache, `session.ts` cachedSessionSecret, `upload-tracker-state.ts` global, `use-display-capability.ts` snapshot, `admin-backfill-runner.ts` global. **Every entry is pre-existing and already documented under "Runtime topology" in CLAUDE.md.** Cycle-1 added NO new process-local coordination state — the new rate-limit helper `rollbackSemanticAttempt` (`rate-limit.ts:361`) reuses the existing bounded-map limiter; the backfill rewrite reuses the existing `admin-backfill-runner.ts` global. Horizontal-scale debt is unchanged from cycle 1.

### 4. Half-integrated subsystems

- **feature-flags.ts** — fully DELETED (CRT-R5C1-03). Grep confirms zero dangling importers in `src/`, `scripts/`, or `__tests__/`; the only residual mention is a historical comment in `hdr-filenames.ts:2`. Clean removal. ✓
- **hdr-filenames.ts** — RESERVED/NOT-WIRED banner now explicit; the honesty invariant is enforced by `_PrivacySensitiveKeys`, not a flag. Clean. ✓
- **storage abstraction** (`src/lib/storage/`) — still not wired into the pipeline; `switchStorageBackend` type is now `'local'`-only. CRT-R5C1-05 (make it throw NotImplemented) is already planned in plan-316 Unit C → suppressed.
- **caption-generator.ts** (US-P52 Florence-2 stub) — pure stub, see ARCH-R5C2-02. Documented DEFERRED-FIX present.
- **clip-inference / semantic search** (US-P51) — `embedTextStub` stub; the route capability gate is correct (see §6). `'production'` is now unreachable end-to-end (validator rejects write, default heals stale rows to `'disabled'`, route 503s).
- **Stripe entitlements / Lightroom PAT** — no cycle-1 structural change; checkout-route tests added only.

### 5. Config layering — site-config.json / admin_settings / env (verified consistent)

`semantic_search_mode` defense-in-depth traced end-to-end:
- **Write path:** `actions/settings.ts:63` enforces `isValidSettingValue` before persist; the validator (`gallery-config-shared.ts:171`) now rejects `'production'`. No other write path to that key exists (grep clean).
- **Read/resolve path:** `gallery-config.ts:125-127` — a stale DB `'production'` row fails `isValidSettingValue` → falls back to `DEFAULTS.semantic_search_mode = 'disabled'` (`gallery-config-shared.ts:108`).
- **Route path:** `api/search/semantic/route.ts:188` requires `=== 'stub'`, so resolved `'disabled'` → 503.

All three layers agree. The only residue is a type-hygiene drift (ARCH-R5C2-03, LOW).

### 6. Semantic-search rate-limit reorder (verified correct, no finding)

Commit `1fabf9ec` moved the rate-limit pre-increment BEFORE the config read (COR-R5C1-04) to stop free config probing. Every subsequent early-return path (`:189` 503, `:201` embed-fail, `:214` db-fail) calls `rollbackSemanticAttempt(ip)` to refund the budget; only successful expensive work consumes it. Balanced and correct.

### 7. Backfill keyset pagination (verified correct, behavioral note → ARCH-R5C2-04 LOW)

Commit `8bc3c51b` (PERF-R5C1-01) replaced the up-front `fetchCandidates()` snapshot with per-batch `fetchCandidateBatch(cursor)` (`admin-backfill-runner.ts:160-174`). Loop (`:317-352`): fetch `id > cursor LIMIT 100`, drain via `queue.onIdle()`, advance `cursor = batch[last].id`, break on short/empty batch. `id` is `number` and monotonic → terminates. The detection-failure rows (`:260-281`) keep `pipeline_version < CURRENT` but their `id <= cursor`, so they are correctly NOT re-picked within the run (no infinite loop) and ARE eligible on the next manual trigger — preserving the documented AGG-01/AGG-02 resume contract. Minor behavioral delta noted below.

### 8. Build/deploy + dependency architecture (no new findings)

- Dockerfile multi-stage (`build-base`/`deps`/`prod-deps`/`builder`/`runner`) unchanged; standalone output + migrate.js/mysql-connection-options copied into runner. SW prebuild hook stamps `public/sw.js` (refreshed `9340b5ce`). Consistent.
- `deploy.sh` fails fast on missing `.env.local` and `site-config.json`. nginx body caps (`nginx/default.conf`) align with documented app limits (2M default / 64K login / 250M db / 216M dashboard).
- `apps/web/package.json`: 38 deps, latest majors (next 16.2, react 19.2, sharp 0.34.5, drizzle 0.45.2, stripe 22.1, mysql2 3.22). No duplicate-purpose deps surfaced. `onnxruntime-node` correctly NOT yet present (matches caption-generator's deferred status). Transitive postcss CVE already tracked as SEC-R5C1-03 (suppressed).

---

## Root Cause

The single new structural risk (ARCH-R5C2-02) stems from a convenience refactor: to strip a stub prefix from display titles, a client-reachable utility module took a hard import on a server-side ML-stub module. Because the stub is currently inert (no native deps), no build error surfaces — so the boundary violation is invisible until the deferred ONNX wiring lands. The absence of a `server-only` sentinel on `caption-generator.ts` means the compiler cannot enforce the boundary that the architecture intends.

---

## Recommendations

1. **ARCH-R5C2-02 (HIGH)** — Break the client→server-stub import edge. Lowest-effort: move `ALT_TEXT_STUB_PREFIX` into a client-safe constants module (e.g. `lib/caption-constants.ts` or `lib/image-types.ts`, which `photo-title.ts` already imports) and have BOTH `caption-generator.ts` and `photo-title.ts` import from there. Effort S. Impact: closes a latent build-breaker before WI-P52.
2. **ARCH-R5C2-02 belt-and-braces** — Add `import 'server-only';` to the top of `caption-generator.ts` once the prefix is extracted, so any future client import is a compile-time error, not a runtime bundle surprise. Effort S.
3. **ARCH-R5C2-03 (LOW)** — Narrow the `semanticSearchMode` type union to `'disabled' | 'stub'` (drop `'production'`) at `gallery-config.ts:65/127/182`, OR add a comment that `'production'` is intentionally retained as a "rejected/stale" sentinel. Effort S. Impact: removes dead-but-typed value confusion.
4. **ARCH-R5C2-04 (LOW)** — Add a one-line comment at `admin-backfill-runner.ts:160` noting the keyset re-query is intentionally non-snapshotting and relies on the advisory lock + `pipeline_version=CURRENT` on fresh uploads to avoid mid-run double-pick. Effort S. Impact: documents the behavioral delta from the deleted snapshot path.

---

## Trade-offs

| Option (ARCH-R5C2-02 fix) | Pros | Cons |
|--------|------|------|
| Extract prefix to shared client-safe const module | Clean boundary; tree-shake-proof; tiny diff | One new tiny file (or reuse image-types.ts) |
| Add only `server-only` to caption-generator, keep import | Enforces boundary at compile time | BREAKS the build today (photo-title is client-reachable) — must extract first |
| Inline the literal `'[AUTO] '` in photo-title | Zero import | Duplicates a magic string across two modules; drifts on change |

---

## Findings

### ARCH-R5C2-02 — Client-reachable `photo-title.ts` hard-imports server-stub `caption-generator.ts` (latent bundle trap)
- **File:** `apps/web/src/lib/photo-title.ts:2` imports `ALT_TEXT_STUB_PREFIX` from `apps/web/src/lib/caption-generator.ts:31`. `photo-title.ts` is imported by `apps/web/src/components/{home-client,lightbox,photo-viewer,info-bottom-sheet,tag-filter}.tsx` (all `'use client'`) and `on-this-day-widget.tsx`.
- **Why a problem:** `caption-generator.ts` is the US-P52 Florence-2 stub. Its docblock (`:1-19`) records a DEFERRED-FIX to add `onnxruntime-node` (~150 MB native binaries, the comment's own words) plus model-file/`@/db` access "once real inference ships." There is NO `server-only` guard on the module. Today the module is pure (grep confirms zero node-only imports) so the client bundle is fine — but the boundary is enforced by nothing.
- **Failure scenario:** WI-P52 implementer adds `import * as ort from 'onnxruntime-node'` (or `import { db } from '@/db'`) to `caption-generator.ts`. Next build, every `'use client'` component transitively importing `photo-title.ts` pulls the server module into the client graph → either a hard build failure ("Module not found: Can't resolve 'onnxruntime-node'" in browser context) or, worse, a silently bloated/broken client bundle. The CRT-R5C1-02 fix that motivated the import will have planted the mine.
- **Suggested fix:** Extract `ALT_TEXT_STUB_PREFIX` to a client-safe constants module (reuse `lib/image-types.ts`, already imported by `photo-title.ts`) and import it from there in both files; then add `import 'server-only';` to `caption-generator.ts`.
- **Severity:** HIGH (latent; fires on the next WI-P52 commit) · **Confidence:** High · **Classification:** confirmed (import chain and client directives both verified; module currently pure verified)

### ARCH-R5C2-03 — `semanticSearchMode` type union retains unreachable `'production'` value
- **File:** `apps/web/src/lib/gallery-config.ts:65, 127, 182` (`'disabled' | 'stub' | 'production'`).
- **Why a problem:** After CRT-R5C1-01, no value path can ever yield `'production'`: the write-path validator (`gallery-config-shared.ts:171`) rejects it, and the resolver defaults stale rows to `'disabled'` (`:127`). The type still advertises a third state that the system can never be in, inviting a future reader to branch on it (the route already has to special-case it as 503).
- **Failure scenario:** A later contributor adds `if (mode === 'production') { /* serve real results */ }` in some new consumer, trusting the type, and ships a path that the encoder can't honor — re-opening the exact honesty hazard CRT-R5C1-01 closed.
- **Suggested fix:** Narrow the union to `'disabled' | 'stub'` (and the route's local `semanticMode` type), or annotate `'production'` as a rejected-sentinel-only value with a comment.
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed

### ARCH-R5C2-04 — Backfill keyset re-query drops the old snapshot's mid-run isolation (benign, undocumented)
- **File:** `apps/web/src/lib/admin-backfill-runner.ts:160-174` (`fetchCandidateBatch`), `:317-352` (loop).
- **Why a problem:** The pre-cycle-1 code fetched the full candidate set ONCE; the new loop re-queries `WHERE pipeline_version < CURRENT AND id > cursor` each batch. This is a deliberate memory win (O(batch) residency) but silently changes the iteration model from "snapshot at start" to "live re-scan." It is safe today only because (a) the `gallerykit_color_pipeline_backfill` advisory lock serializes all backfills and (b) fresh uploads land at `pipeline_version = CURRENT` so they never enter the candidate set mid-run. Neither guarantee is stated at the new code site.
- **Failure scenario:** A future change that lets concurrent work lower a row's `pipeline_version` below CURRENT mid-run (e.g. a per-row "force re-detect" admin button outside the lock) would cause that row to be re-picked unexpectedly within the same run. No such path exists today — hence benign — but the invariant is undocumented.
- **Suggested fix:** One-line comment at `:160` stating the re-query relies on the advisory lock + fresh-upload-at-CURRENT invariant for correctness, mirroring the snapshot semantics it replaced.
- **Severity:** LOW · **Confidence:** Medium · **Classification:** likely (behavior verified correct today; the risk is evolution-trap, not a present bug)

---

## Final sweep — surfaces covered

1. **Module/layer boundaries** (app→actions→lib→db, client/server split, client-safe lib files) — COVERED. Found ARCH-R5C2-02. Verified `color-primaries.ts`/`color-pipeline-decisions.ts` client-safe lib files untouched; verified changed UI files (info-bottom-sheet, lightbox, upload-dropzone, home-client) added NO new imports (a11y-only).
2. **Schema & migration integrity** (0019/0020/0021 three-way drift, index dup, FK consistency) — COVERED. All consistent; 0021 fully runbook-compliant; post-condition guard covers it.
3. **Process-local state inventory vs single-writer** — COVERED. No NEW state added in cycle 1.
4. **Half-integrated subsystems** (storage, CLIP/embeddings, smart_collections, Lightroom PAT, Stripe, caption-generator, hdr-filenames, feature-flags) — COVERED. feature-flags cleanly deleted; caption-generator → ARCH-R5C2-02; storage NotImplemented already planned (suppressed).
5. **Config layering** (site-config / admin_settings / env, validation at each layer) — COVERED. `semantic_search_mode` defense-in-depth verified sound across all three layers; ARCH-R5C2-03 type residue.
6. **Build/deploy** (Dockerfile stages, standalone, sw hook, deploy.sh, nginx alignment) — COVERED. No new findings.
7. **Dependency architecture** (package.json pins, duplicates, transitive risk) — COVERED. 38 deps, latest majors, no duplicates; onnxruntime-node correctly absent; postcss CVE already tracked (suppressed).

**Net new findings:** 1 HIGH (ARCH-R5C2-02), 0 MED, 2 LOW (ARCH-R5C2-03, ARCH-R5C2-04). 0 CRIT.
