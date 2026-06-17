# Architect Review — Cycle 11 (Run-6)

**HEAD:** a7de3ebd · **Scope:** system architecture at the documented single-writer scale
**Verdict:** SOUND. Zero new architectural defects. Honest convergence.

## Summary

Traced the full config → resolution → consumption chain, the CLIP double-gate,
advisory-lock acquire/release pairing across all three lock-using subsystems, and
the data.ts PII guard architecture. Every invariant the task asked me to verify
holds. `npx tsc --noEmit -p tsconfig.typecheck.json` exits 0, so both compile-time
privacy guards are satisfied. No fail-open where fail-closed is required; no leaked
advisory-lock connection; no PII leak; no contract mismatch between layers that
produces wrong behavior at the documented scale.

I found ONE prose/comment inaccuracy (not a defect — produces no wrong behavior at
any scale) and note it for honesty, plus confirmation that the 3 known-deferred CLIP
items remain correctly deferred.

## What I verified

### 1. Config double-gate is fail-closed end to end (CLIP `production`)

- **Validation layer** (`gallery-config-shared.ts:173`): `semantic_search_mode`
  accepts `disabled|stub|production` as type-valid stored values. Correct — the
  resolver, not the validator, owns the heal.
- **Resolution layer** (`gallery-config.ts:129-148`): a stored `production` HEALS to
  `disabled` unless `process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true'`.
  Invalid/unknown raw → default (`disabled`). The DB-read failure path
  (`gallery-config.ts:189-219` catch) returns an all-defaults object →
  `semanticSearchMode: 'disabled'`. Fail-closed.
- **Consumption layer** — three independent re-reads, each fail-closed:
  - `api/search/semantic/route.ts:220-233`: defaults `semanticMode='disabled'`,
    `getGalleryConfig()` in try/catch (`catch → stays disabled`), then
    `if (semanticMode !== 'stub' && !== 'production') → 503` + rate-limit rollback.
  - `api/search/similar/[id]/route.ts:94-107`: same pattern, stricter
    (`!== 'production' → 503`).
  - `app/actions/embeddings.ts:74-82` and `lib/image-queue.ts:435-442`: both default
    to `disabled`, catch DB errors as `disabled`, and no-op on `disabled`.

  The double gate (env `SEMANTIC_SEARCH_ALLOW_PRODUCTION` + DB row) is enforced at
  the SINGLE resolution chokepoint and every consumer reads the resolved value.
  There is no path where a consumer reads the raw DB string directly. **Fail-closed
  confirmed.**

### 2. model_version isolation at the query layer

Read routes filter `WHERE model_version = activeModelVersion`
(`semantic/route.ts:254`, `similar/[id]/route.ts:117,145`). Write paths tag the row
with the active model_version (`image-queue.ts:446-451`, `embeddings.ts:92`,
sidecar). Stub mode uses `cosineSimilarity` (stub vectors are unnormalized);
production uses `dotProduct` on unit vectors (`semantic/route.ts:271` gated on
`isProd`). Stub rows are filtered out of production reads and vice-versa. Correct.

### 3. Advisory-lock acquire/release pairing — no leak

Audited all GET_LOCK/RELEASE_LOCK sites:
- `image-queue.ts`: acquire (195-212) releases connection on not-acquired AND on
  throw; consumption acquires at :261 and releases in `finally` at :544-545 covering
  the whole processing window.
- `admin-backfill-runner.ts`: backfill lock (303-333) and per-image claim (343-368)
  both release connection on every path. The outer entry point
  (`triggerAdminBackfill` :816-866) nulls `lockConn` after handoff (:846) so the
  catch cannot double-release; the runner's `finally` (:805-808) is the single
  release point. `reprocessOne` claim acquire and protected `try` are adjacent with
  release in `finally` (:610-614) — documented LOCK-CRITICAL.
- Pool-exhaustion on `getConnection()` is handled as a `locked` skip (no version
  bump), not an escape that would tight-loop errors. Correct degradation.

No connection or lock is leaked on any path.

### 4. data.ts PII guard architecture

- `publicSelectFields` (data.ts:325-357) and `publicMapSelectFields` (:366-393) are
  DERIVED from `adminSelectFields` by destructuring-OMIT, as separate `as const`
  objects (not shared references). Adding a field to `adminSelectFields` does NOT
  auto-leak it.
- `PrivacySensitiveKeys` (:416) is the single source-of-truth union. Both
  `_SensitiveKeysInPublic` (:418-420) and `_MapSensitiveKeysInPublicMap` (:429-432)
  derive from it via `Extract`/`Exclude` → a new sensitive key auto-extends both
  guards.
- **`tsc --noEmit -p tsconfig.typecheck.json` exits 0** → no sensitive key is present
  in either public select shape. Guard is live and passing.

## Finding (non-defect, documentation honesty only)

**A1 · `image-queue.ts:431-433` comment overstates row coexistence · LOW · confidence H**

The `image_embeddings` table has `PRIMARY KEY (image_id)` only (schema.ts:274,
migration 0012:10) — exactly ONE row per image. The comment at image-queue.ts:431-433
("The `model_version` column on image_embeddings already distinguishes stub rows, so
no schema migration is needed for that future encoder to tell stub vectors apart from
production ones") reads as if stub and production rows coexist per image. They do not.

- **Actual (correct) behavior:** the upsert (`onDuplicateKeyUpdate` on the `imageId`
  PK, image-queue.ts:462-473 / embeddings.ts:142-153) OVERWRITES `(embedding,
  modelVersion)`. During a stub→production transition the backfill `notExists`
  candidate query selects images lacking a row *at the target version*
  (embeddings.ts:103-112, sidecar "Re-embed on model_version mismatch"), so a stale
  stub row is selected and overwritten with the production row. Reads filter on the
  active version. Net effect: stub vectors are never co-ranked with production —
  the documented invariant holds via overwrite-then-filter, NOT coexistence.
- **Why it is not a defect:** there is no scale, including the documented
  single-writer topology, at which this produces wrong output or data loss. Only one
  mode is ever resolved-active per deploy; the single row always carries that mode's
  version after backfill. The `backfill-clip-embeddings-reembed` test locks the
  re-embed-on-mismatch semantics.
- **Fix (optional, non-urgent):** reword the comment to say the single row is
  *re-embedded/overwritten* to the active model_version (and reads filter on it),
  rather than implying per-image stub+production coexistence. No code change.

## Known-deferred items (NOT re-opened)

DEF-C8-1/2/3 (plan-361): main-thread inference vs worker-pool, load-time integrity
verification, reload-storm hardening. Confirmed these remain correctly deferred — the
live feature operates within the documented bounded mitigations (lazy Promise-singleton
load, offline `allowRemoteModels=false`, pinned HF revision, 0-timeout claim locks,
30/min IP rate limit fail-closed even on the shared `unknown` bucket). Not new findings.

## References

- `apps/web/src/lib/gallery-config-shared.ts:173` — validator accepts production (type-valid)
- `apps/web/src/lib/gallery-config.ts:129-148` — resolver heals production→disabled w/o env opt-in
- `apps/web/src/lib/gallery-config.ts:189-219` — DB-read failure → all-defaults (disabled)
- `apps/web/src/app/api/search/semantic/route.ts:220-233` — fail-closed 503 gate
- `apps/web/src/app/api/search/similar/[id]/route.ts:94-107` — production-only fail-closed gate
- `apps/web/src/lib/image-queue.ts:434-478` — write path mode-gated, default disabled
- `apps/web/src/app/actions/embeddings.ts:74-92,103-112` — mode-aware backfill, version-filtered candidates
- `apps/web/src/lib/admin-backfill-runner.ts:303-333,610-614,805-808,816-866` — lock lifecycle, single release point
- `apps/web/src/lib/image-queue.ts:195-222,261,544-545` — claim acquire/release in finally
- `apps/web/src/lib/data.ts:325-357,416-432` — PII guard derivation + compile-time guards
- `apps/web/src/db/schema.ts:273-288` + `apps/web/drizzle/0012_image_embeddings.sql:10` — single-row PK (finding A1)
