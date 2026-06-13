# Architect Review — GalleryKit (cycle 3, review-plan-fix)

- **HEAD reviewed:** `ada92ba5` (`test(security): pin shared og-sanitize global-strip contract`)
- **Scope:** architectural / design-risk — coupling, layering, cohesion, abstraction boundaries, contract stability, scalability cliffs, single-points-of-failure.
- **Method:** read every file region cited below; no claim without file:line evidence.
- **Prior-cycle closed items NOT re-litigated:** advisory-locks.ts docblock (ARCH-1 prior), the new `lib/og-sanitize.ts` abstraction (evaluated fresh below, judged sound), documented-accepted tradeoffs (single-pool/single-writer, `view_count` in-memory buffer, `@/lib/storage` unwired, `revalidate=0`, advisory-locks scoped to MySQL server).

---

## Summary

The architecture is, on the whole, disciplined: the data-access privacy boundary, the config-flow layering, and the concurrency-lock design are all stronger than typical. The new `og-sanitize.ts` abstraction is correctly placed and closes a real symmetry gap. The genuine design risks are narrow and concentrated:

1. **ARCH-1 (Medium):** the in-app backfill runner re-encodes and writes derivative files but — unlike the upload queue worker — never checks `affectedRows` on its version-bump UPDATE, so a `deleteImage` that races a backfill leaks orphaned derivative files. The two writers diverge on a contract the queue worker explicitly enforces.
2. **ARCH-2 (Medium):** `lib/api-auth.ts` imports `isAdmin` from `@/app/actions/auth`, an upward lib→app dependency. The auth primitive lives in the `app` layer, forcing a `lib` module to reach up into it — a layering inversion that couples the whole `lib` boundary to a server-action file.
3. **ARCH-3 (Medium):** the ICC-name→gamut string-token matching is triplicated across three functions (`color-detection.inferColorPrimaries`, `process-image.resolveColorPipelineDecision`, `process-image.resolveAvifIccProfile`) with identical token sets but divergent outputs. A new gamut keyword must be added in three places or detection silently disagrees with delivery.
4. **ARCH-4 (Low):** `COLOR_IMPACTING_KEYS` (settings-hash.ts) is a hand-maintained list that must track `GalleryConfig` shape; it already drifted once (3-key→9-key). Not derived from a single source.
5. **ARCH-5 (Low):** the documented "SERVER-ONLY" libs (`data.ts`, `gallery-config.ts`, `image-queue.ts`, `process-image.ts`, etc.) enforce that boundary only by comment, not by the `server-only` package guard. One file (`caption-generator.ts`) does use it — the inconsistency is the tell.

Top risk to action this cycle: **ARCH-1** (real disk leak with a clear, low-risk fix). ARCH-2/ARCH-3 are maintenance-hazard refactors worth scheduling but lower urgency.

---

## Analysis

### New abstraction evaluation: `lib/og-sanitize.ts` — boundary is correct (no finding)

`apps/web/src/lib/og-sanitize.ts:1-30` exports `sanitizeForOg` + `OG_C0_CONTROL_CHARS`, consumed by both OG routes (`app/api/og/route.tsx:5`, `app/api/og/photo/[id]/route.tsx:8`) and locked by two contract tests (`__tests__/og-sanitize.test.ts`, `__tests__/sanitize-for-og-global.test.ts`).

Assessment — the boundary is right:
- **Placement in `lib/`:** correct. App-Router route files may only export conventional symbols (`runtime`, HTTP handlers); auxiliary helpers must live outside the route (same rationale as the sibling `og-photo-fetch.ts:1-8`). A shared cross-route helper belongs in `lib`.
- **Client-safe classification:** it imports only `stripUnicodeFormatting` from `validation.ts` (`og-sanitize.ts:1`), and `validation.ts` itself imports only `@/lib/constants` + `@/lib/utils` (`validation.ts:1-2`) — no `fs`, no Sharp, no `@/db`, no `server-only`. So `og-sanitize` is genuinely client-safe even though it is presently consumed only server-side. This is the right default (no accidental server-only dependency baked in).
- **Hidden coupling between the two OG routes:** the concern is unfounded. The shared module exposes a *pure string→string function* with no shared mutable state, no module-scoped cache, no I/O. Sharing it creates the intended coupling (one strip policy) without any hidden behavioral coupling. The "derive, don't copy" rationale in the docblock (`og-sanitize.ts:11-16`) is exactly the right call: the prior state had the per-photo route stripping while the home route rendered `siteTitle`/`topicLabel`/tags raw — a real defense-in-depth asymmetry, now closed.

This is a model of how the repo handles its Unicode-format defenses (cf. `sanitize.ts:17` deriving `UNICODE_FORMAT_CHARS_RE` from the same `validation.ts` source). No change recommended.

### Data-access layer (`data.ts`) — privacy boundary is sound (no finding; one Low residual noted under ARCH-5 family)

The `adminSelectFields` → `publicSelectFields` / `adminListSelectFields` / `publicMapSelectFields` derivation (`data.ts:208-393`) is a genuinely strong architectural boundary, not fragile:
- `adminSelectFields` is the single source of truth (`data.ts:208`).
- Every narrower field set is **derived by destructuring-omit** from it (`data.ts:287-312`, `325-357`, `366-393`), so adding a field to the admin set does NOT silently leak it — the field lands in the public sets too unless explicitly omitted, and the *intent* of the omit list is visible at each derivation site.
- THREE compile-time guards back it: `_privacyGuard` (`data.ts:417-419`), `_mapPrivacyGuard` (`data.ts:431`), `_largePayloadGuard` (`data.ts:448-449`), each using `Extract<keyof typeof publicSelectFields, _SensitiveKeys>` to force a TS error if a sensitive/large key reaches the public set.
- `tagNamesAgg` (`data.ts:605`) is correctly shared across all four list queries (`getImagesLite:734`, `getImagesForFeed:783`, `getImagesLitePage:833`, `getImages:866`, `getAdminImagesLite:890`, `getImagesForSmartCollection:1326`), preventing the NULL-subquery regression documented in CLAUDE.md.

**Cached/non-Cached split coherence:** the eight `cache()` wrappers (`data.ts:1562-1573`, plus `getSmartCollectionBySlugCached:1299` and `getSeoSettings`) all wrap *per-request-stable, single-row-or-small-set, SSR-deduped reads* (image by id, topic by slug, tags, shared group). The uncached query functions are precisely the ones that should NOT be `cache()`-wrapped: paginated/cursor list queries (`getImagesLite`, `getImagesLitePage`, `getImages`, `getAdminImagesLite`) take pagination args that vary per call, and `searchImages`/`getMapImages`/`getImageIdsForSitemap` are one-shot. The split is coherent — `cache()` is applied exactly where request-scoped dedup pays off and withheld where argument variance would make it useless or wrong. No finding.

The only residual is convention-dependence: the privacy guard only fires if a new sensitive key is added to BOTH `publicSelectFields` AND the `_PrivacySensitiveKeys` union. A dev who adds a sensitive column to `adminSelectFields`, forgets the omit, AND forgets the union entry leaks it silently. CLAUDE.md/AGENTS.md document the 3-step requirement, and the `privacy-fields.test.ts` fixture is a backstop, but the guard is not self-completing. Folded into ARCH-5 family (Low) rather than raised separately.

### Config flow (`gallery-config-shared` → `gallery-config` → `image-queue`) — clean (no finding)

- `gallery-config-shared.ts` has **zero imports** (verified) — a pure client-safe leaf of constants/types/validators (`GALLERY_SETTING_KEYS`, `isValidSettingValue`, `parseImageSizes`, etc.).
- `gallery-config.ts` is the server layer: it imports `@/db` (`gallery-config.ts:12`), re-exports the shared symbols for server consumers (`gallery-config.ts:17-24`), resolves DB values with per-key validation + default fallback, and wraps the resolver in `cache()` (`gallery-config.ts:212`). The validate-vs-resolve responsibilities are cleanly separated across the two files.
- `image-queue.ts` and `admin-backfill-runner.ts:597` both consume the resolved `GalleryConfig` and pass the encoder-relevant subset to `processImageFormats`. The dependency direction is strictly shared → config → consumer. No layering violation.

The dual-path fallback inside `_getGalleryConfig` (`gallery-config.ts:107-208`) duplicates the defaults block, but that is a deliberate try/catch resilience pattern (DB-unreadable → all-defaults), not a layering smell. Acceptable.

---

## Findings

### ARCH-1 — Backfill runner leaks orphaned derivative files on delete-while-reencode (Medium, High confidence)

**Files:** `apps/web/src/lib/admin-backfill-runner.ts:525-563`; contrast `apps/web/src/lib/image-queue.ts:367-382`; race partner `apps/web/src/app/actions/images.ts:538-620`.

**Design smell — two writers, divergent delete-race contract.** GalleryKit has two code paths that write image derivative files: the upload queue worker and the in-app backfill runner. The queue worker treats "row deleted mid-processing" as a first-class case:

```ts
// image-queue.ts:368-382 — conditional UPDATE + orphan cleanup
const [updateResult] = await db.update(images)
    .set({ processed: true, pipeline_version: ..., ... })
    .where(and(eq(images.id, job.id), eq(images.processed, false)));
if (updateResult.affectedRows === 0) {
    // Image was deleted during processing → clean up the files we just wrote
    await Promise.all([ deleteImageVariants(...webp), ...(avif), ...(jpeg) ]);
    return;
}
```

The backfill runner does NOT mirror this. After re-encoding (which writes new derivative bytes via atomic rename) it issues an **unconditional** UPDATE keyed only on id and never inspects the result:

```ts
// admin-backfill-runner.ts:526-540
await db.execute(sql`
    UPDATE images SET pipeline_version = ${IMAGE_PIPELINE_VERSION}, ... WHERE id = ${row.id}
`);
return { ok: true };
```

**Why it's a risk — concrete leak sequence.** `deleteImage` (`images.ts:538`) does NOT acquire the per-image `gallerykit:image-processing:{id}` claim lock — it removes the row in a transaction (`images.ts:598-602`) and unlinks all derivatives best-effort (`images.ts:613-620`). The backfill *does* hold that claim lock during re-encode (`admin-backfill-runner.ts:455`), but the delete path ignores it. So:
1. Backfill claims image N, begins re-encode.
2. Admin deletes N: row gone, `deleteImageVariants` unlinks current `N*.{avif,webp,jpeg}`.
3. Backfill's atomic renames land AFTER the unlink → `N_*.{avif,webp,jpeg}` re-materialize on disk.
4. Backfill UPDATE matches 0 rows; runner does not check `affectedRows`; returns `{ ok: true }`, increments `processed`.
5. **Orphaned derivative files for a deleted image persist forever**, and the run reports them as a successful re-encode.

This is bounded (only when a delete races an active re-encode of the same row) and is a disk-leak, not data corruption — hence Medium, not High. But it is a direct inconsistency with a contract the sibling writer explicitly enforces, and the runner's own header advertises careful delete-safety ("If the process is killed mid-backfill, the next invocation will pick up where this one left off", `admin-backfill-runner.ts:48-51`) while missing this window.

**Recommended refactor (in priority order):**
1. Make the runner's version-bump UPDATE conditional and check the result, mirroring the queue worker. Change `WHERE id = ${row.id}` to also require the row still exists/processed, capture `affectedRows`, and on 0 run the same `deleteImageVariants` cleanup for webp/avif/jpeg before returning a new `{ ok:false, reason:'deleted-mid-reencode' }`. The runner already imports nothing extra-heavy; `deleteImageVariants` is exported from `process-image.ts` (used by `images.ts`).
2. Add a `deleted-mid-reencode` tally to `AdminBackfillState` so the status surface distinguishes it from `processed` (consistent with the existing `skippedLocked`/`detectionFailures` discrimination).
3. (Defense-in-depth, optional) have `deleteImage`/`deleteImages` acquire the `gallerykit:image-processing:{id}` claim lock before unlinking, so a delete waits for any active encode to finish. This is the more thorough fix but touches the delete hot path; the affectedRows guard (1) is sufficient and lower-risk.

**Trade-off:** option 1 adds one cleanup branch and a counter — minimal surface, matches existing patterns. Option 3 is architecturally cleaner (delete honors the same lock every other writer respects) but adds a lock acquire + potential wait to user-facing deletes; defer unless the leak proves frequent.

### ARCH-2 — `lib/api-auth.ts` depends upward on `app/actions/auth.ts` (layering inversion) (Medium, Medium confidence)

**Files:** `apps/web/src/lib/api-auth.ts:1` (`import { isAdmin } from '@/app/actions/auth'`); the auth primitive's home `apps/web/src/app/actions/auth.ts:12-21` (imports ~10 `@/lib/*` modules).

**Design smell — the `lib` boundary points up into `app`.** The dependency contract in this repo is otherwise consistent: `app/**` (routes, server actions) depends on `lib/**`; `lib/**` is the leaf. `app/actions/auth.ts` follows it (it imports `@/lib/session`, `@/lib/sanitize`, `@/lib/rate-limit`, `@/lib/auth-rate-limit`, `@/lib/audit`, `@/lib/request-origin`, etc.). But `lib/api-auth.ts` — the `withAdminAuth` wrapper that EVERY `/api/admin/**` route is required to use (per the `lint:api-auth` gate) — reaches back up into `app/actions/auth.ts` for `isAdmin` (`api-auth.ts:100`).

**Why it's a risk:**
- It creates a near-cycle at the module-graph level: `app/actions/auth.ts` pulls in a large `lib` subtree, and one `lib` module pulls `app/actions/auth.ts` back. There is no hard ESM import cycle today (auth.ts does not import api-auth.ts), but the boundary is no longer a DAG by layer — any future `lib`→`api-auth` import that also transitively reaches `auth.ts`'s lib deps risks a real cycle, and bundler/server-action boundary rules (`'use server'` files have special compilation semantics) make app→lib→app chains fragile.
- It conceptually misplaces the auth primitive: `isAdmin()` is a pure-ish session/cookie check that the *lib* layer needs, yet it lives in the *server-action* layer. Anything in `lib` that wants to gate on admin identity must import an `app/actions` file — an inversion that will be copied by the next contributor.

**Recommended refactor:** extract the session-identity primitives (`isAdmin`, `getCurrentUser`, and the cookie/session verification they wrap) into a `lib/auth-session.ts` (server-only) leaf, and have BOTH `app/actions/auth.ts` and `lib/api-auth.ts` import from there. `app/actions/auth.ts` keeps the `'use server'` login/logout mutations; the read-only identity checks move down a layer. This makes the layer graph a clean DAG again.

**Trade-off:** the move touches every current `isAdmin` import site (~15 files, listed: `app/actions/*`, two `api/admin/*` routes, three admin pages). It is a mechanical re-point, but it is broad — schedule it as a focused refactor with the `lint:api-auth` + `lint:action-origin` gates as the safety net, not a drive-by. Confidence is Medium (not High) because the absence of a hard cycle today makes this a hygiene/future-proofing call rather than an active defect.

### ARCH-3 — ICC-name→gamut string matching triplicated across detection and two delivery resolvers (Medium, High confidence)

**Files:** `apps/web/src/lib/color-detection.ts:58-70` (`inferColorPrimaries`); `apps/web/src/lib/process-image.ts:661-713` (`resolveColorPipelineDecision`); `apps/web/src/lib/process-image.ts:754-785` (`resolveAvifIccProfile`).

**Design smell — one fact, three hand-rolled parsers.** All three functions normalize the ICC name (`normalizeName`, shared from color-detection.ts — good) and then run the *same token ladder* over it:

```
displayp3 / p3d65 / dcip3 / adobe|adobergb / prophoto / bt2020|rec2020|iturbt2020 / srgb|iec61966
```

- `inferColorPrimaries` (color-detection.ts:62-67) maps those tokens → `colorPrimaries` enum (audit column).
- `resolveColorPipelineDecision` (process-image.ts:690-707) maps the SAME tokens → `ColorPipelineDecision` enum (delivery).
- `resolveAvifIccProfile` (process-image.ts:766-779) maps the SAME tokens → `AvifIccDecision` enum (AVIF output ICC).

The docblock on `inferColorPrimaries` (color-detection.ts:56-57) even asserts it uses "the same canonical mapping as resolveColorPipelineDecision" — a comment promising a coupling the code does not structurally enforce.

**Important distinction — the NCLX↔ICC *precedence inversion* is NOT a defect.** `detectColorSignals` resolves audit `color_primaries` NCLX-first (color-detection.ts:370-387), while `resolveColorPipelineDecision` resolves delivery ICC-name-first and falls back to NCLX only when the name is opaque (process-image.ts:665-685). The docblock (process-image.ts:665-682) explains this is intentional: the two answer different questions (what the container is tagged as vs. which working-space the photographer edited in). I agree — flipping the delivery resolver to NCLX-first would change delivered bytes for conflicting sources. Leave the precedence alone. The finding is strictly about the *duplicated token ladder*, not the precedence.

**Why it's a risk.** When WI-09 (HDR/rec2100) lands, or any new gamut keyword needs recognizing (the comments at process-image.ts:709-712 and color-primaries.ts:33-34 already anticipate this), the keyword must be added to all THREE ladders. Miss one and detection disagrees with delivery — e.g. the audit panel shows `color_primaries=bt2020` while AVIF silently delivers sRGB because `resolveAvifIccProfile` did not learn the new token. That is a per-photo colorimetric correctness bug that no current test would catch (each function is tested in isolation against its own enum).

**Recommended refactor:** introduce one canonical classifier in a client-safe module (alongside `color-primaries.ts`), e.g. `classifyIccNameToPrimaries(normalizedName): ColorPrimariesValue | null`, owning the single token ladder. Then:
- `inferColorPrimaries` becomes `classifyIccNameToPrimaries(name) ?? 'unknown'`.
- `resolveColorPipelineDecision` and `resolveAvifIccProfile` call the classifier first, then map the resulting `ColorPrimariesValue` through the existing `resolveDecisionFromPrimaries` (process-image.ts:649) / `resolveAvifFromPrimaries` (process-image.ts:745) — which already exist and already map primaries→decision. This collapses the three ladders into one and makes the primaries→decision step the only place delivery diverges. The precedence inversion is preserved (the resolvers still consult the ICC name before NCLX `signals`; only the *string-matching* is unified).
- Lock with a test that walks every `ColorPrimariesValue` and asserts all three consumers agree on classification.

**Trade-off:** modest refactor of three functions that already share `normalizeName` and already have primaries→decision helpers; risk is low because the token ladder is identical today (the refactor is behavior-preserving). The payoff is that the WI-09 gamut addition becomes a one-line change instead of a three-site change with a silent-disagreement failure mode.

### ARCH-4 — `COLOR_IMPACTING_KEYS` is a hand-maintained list that must track `GalleryConfig` (Low, High confidence)

**File:** `apps/web/src/lib/settings-hash.ts:37-46` (`COLOR_IMPACTING_KEYS`) + `buildHashFromConfig:79-93`.

**Design smell — a second, manually-curated subset of the settings keys.** The ETag-invalidation hash is computed over a hardcoded list of 9 keys (settings-hash.ts:37-46). This list is NOT derived from `GALLERY_SETTING_KEYS` (gallery-config-shared) nor from the `GalleryConfig` shape; it is a separate literal that a developer must remember to extend whenever a new setting affects encoded bytes. The docblock itself records that it already drifted: "AGG-R7-08 corrected this docstring from a stale 3-key summary" (settings-hash.ts:6-7), and `buildHashFromConfig` (settings-hash.ts:81-90) re-lists the same 9 fields a third time as `config.*` accessors.

**Why it's a risk.** Adding a new color/quality/size setting to `gallery-config-shared` + `GalleryConfig` + `image-queue` (the documented 3-step) but forgetting this list means cached derivatives are NOT invalidated when an admin flips the new setting — exactly the failure mode the hash exists to prevent (the docblock's own example: an admin flips `force_srgb_derivatives` to fix a colorimetric bug and ships it only to fresh browsers). The consequence is a subtle, hard-to-diagnose "stale bytes on existing clients" bug, deferred until someone changes the setting in production. Low severity because the list is correct today and changes to color-impacting settings are infrequent.

**Recommended refactor:** drive the hash off the resolved `GalleryConfig` field set with a typed exhaustiveness check, OR add a single source-of-truth array (e.g. `COLOR_IMPACTING_CONFIG_FIELDS: (keyof GalleryConfig)[]`) consumed by both `buildHashFromConfig` and the DB-fetch path, with a `satisfies` assertion so a new color-impacting field that is not listed produces a type error. Pair with a test that asserts the DB-key list and the config-field list have matching cardinality.

**Trade-off:** the typed approach removes the drift class entirely; cost is a small refactor of two functions that already enumerate the same fields. Worth doing opportunistically, not urgent.

### ARCH-5 — "SERVER-ONLY" libs enforced by comment, not by `server-only` guard (Low, Medium confidence)

**Files:** `apps/web/src/lib/gallery-config.ts:8-10` (comment "This module imports from @/db and is SERVER-ONLY"), and the same convention-only posture in `lib/data.ts`, `lib/image-queue.ts`, `lib/process-image.ts`, `lib/analytics-data.ts`, `lib/db-restore.ts`, `lib/admin-tokens.ts` (verified: zero `server-only` imports in any of them). Contrast `apps/web/src/lib/caption-generator.ts`, which DOES `import 'server-only'`.

**Design smell — inconsistent enforcement of the most important `lib` sub-boundary.** The repo clearly knows the `server-only` package (caption-generator uses it). Yet the heaviest server-only modules — every `@/db`-importing data/config/queue file — declare their server-only-ness only in a docstring. Today nothing imports them from a client component (verified: no `components/**` imports `process-image`/`image-queue`), so there is no live bug. But the boundary that prevents a future client import from silently dragging `@/db` (and Sharp, and `mysql2`) into the client bundle is a comment, not a compiler error.

**Why it's a risk.** A future contributor importing, say, a type or a small helper from `data.ts` into a client component would not get a build-time failure — they would get a bloated/broken client bundle or a confusing runtime error, instead of the clear "You're importing a Server Component module on the Client" message that `server-only` produces at build time. The lone `caption-generator.ts` guard makes the omission elsewhere look accidental rather than deliberate.

**Recommended refactor:** add `import 'server-only';` to the top of the DB-touching server modules (`data.ts`, `gallery-config.ts`, `image-queue.ts`, `process-image.ts`, `analytics-data.ts`, `db-restore.ts`, `admin-tokens.ts`, `settings-hash.ts`). The split between these and their client-safe counterparts (`color-primaries.ts`, `color-pipeline-decisions.ts`, `gallery-config-shared.ts`, `validation.ts`, `og-sanitize.ts`) is already clean, so this is purely additive — it codifies the existing intent. Same family includes the data.ts privacy-guard convention-dependence noted in the Analysis section (the guard is sound but self-completes only if the dev also updates the `_PrivacySensitiveKeys` union).

**Trade-off:** trivial change, no behavioral effect on correct code; the only "cost" is that it will surface any pre-existing illicit client import as a build error (which is the point). Low risk, low effort.

---

## Trade-offs (cross-cutting)

| Concern | Option A | Option B |
|---|---|---|
| ARCH-1 delete race | `affectedRows`-guarded UPDATE + cleanup in runner (small, mirrors queue worker) | `deleteImage` acquires per-image claim lock (cleaner DAG of writers, but adds lock wait to user-facing delete) |
| ARCH-2 layering | Extract `isAdmin`/identity to `lib/auth-session.ts` leaf (fixes DAG, broad re-point ~15 files) | Leave as-is (no hard cycle today; accept the inversion) |
| ARCH-3 color ladder | One `classifyIccNameToPrimaries` classifier feeding existing primaries→decision helpers (behavior-preserving) | Keep three ladders, add a cross-consumer agreement test as a tripwire (cheaper, doesn't remove the hazard) |

---

## Not findings (verified sound or documented-accepted)

- **`og-sanitize.ts` abstraction** — correct placement, correctly client-safe, no hidden coupling (pure function). Sound.
- **`data.ts` select-field privacy boundary** — single-source `adminSelectFields` + derived omit + three compile-time guards. Strong.
- **`data.ts` Cached/non-Cached split** — `cache()` applied exactly to per-request-stable single-row reads; withheld from paginated/one-shot queries. Coherent.
- **Config flow** `gallery-config-shared` (zero-import leaf) → `gallery-config` (DB + cache) → `image-queue`/`backfill`. Clean DAG.
- **Advisory-lock concurrency design** — backfill runner acquires run-level lock (non-blocking), per-image claim lock matching `image-queue.ts` semantics, reserves pool connections (`resolveBackfillConcurrency`), treats pool exhaustion as retryable `locked` skip. No new second-writer race introduced *except* the delete-side gap in ARCH-1 (which is a missing-guard, not a missing-lock-on-the-writer).
- **NCLX↔ICC precedence inversion** (audit NCLX-first vs delivery ICC-first) — intentional and documented (process-image.ts:665-682); explicitly NOT re-litigated.
- **og-photo-fetch SSRF surface** — fetches `${origin}/uploads/jpeg/<validated-filename>` where origin is the request's own origin and filename derives from a DB-stored validated record; path is fixed, no user-controlled host. Bounded.
- **Documented-accepted tradeoffs** — single-pool/single-writer topology, `view_count` in-memory buffer, `@/lib/storage` unwired abstraction, `revalidate=0` public freshness, advisory-locks scoped to MySQL-server. Per CLAUDE.md; not defects.

---

## References

- `apps/web/src/lib/og-sanitize.ts:1-30` — new shared OG sanitizer (sound boundary).
- `apps/web/src/app/api/og/route.tsx:5,82-88` and `apps/web/src/app/api/og/photo/[id]/route.tsx:8,81-83` — both OG-route consumers.
- `apps/web/src/lib/validation.ts:1-2,58,92` — confirms `og-sanitize` dep chain is client-safe.
- `apps/web/src/lib/admin-backfill-runner.ts:455,525-563` — ARCH-1: unconditional UPDATE, no `affectedRows` orphan cleanup.
- `apps/web/src/lib/image-queue.ts:367-382` — the conditional-UPDATE + orphan-cleanup contract the backfill omits.
- `apps/web/src/app/actions/images.ts:538-620` — `deleteImage` does not take the per-image claim lock (ARCH-1 race partner).
- `apps/web/src/lib/api-auth.ts:1,100` — ARCH-2: lib→app `isAdmin` import.
- `apps/web/src/app/actions/auth.ts:12-21` — auth primitive's current (app-layer) home.
- `apps/web/src/lib/color-detection.ts:58-70,370-387` — ARCH-3 ladder #1 + the intentional NCLX-first audit precedence.
- `apps/web/src/lib/process-image.ts:649-713,745-785` — ARCH-3 ladders #2/#3 + the intentional ICC-first delivery precedence.
- `apps/web/src/lib/settings-hash.ts:37-46,79-93` — ARCH-4: triple-listed `COLOR_IMPACTING_KEYS`.
- `apps/web/src/lib/gallery-config.ts:8-10,107-212` — ARCH-5: comment-only server-only; clean validate/resolve split.
- `apps/web/src/lib/gallery-config-shared.ts` — zero-import client-safe config leaf (config flow is clean).
- `apps/web/src/lib/data.ts:208-401,605,1562-1573` — sound privacy boundary + coherent Cached split (no finding).
- `apps/web/src/lib/caption-generator.ts:1` — the one lib that does use `server-only` (ARCH-5 inconsistency tell).
