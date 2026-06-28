# Tracer Review — Cycle 19

Generated: 2026-06-27
Reviewer: oh-my-claudecode:tracer

---

## Trace Report

### Observation

Four high-risk data/control flows in the GalleryKit codebase were traced end-to-end with competing causal hypotheses. Evidence was collected from:

- `apps/web/src/app/actions/images.ts` (upload action, quota claim, enqueue)
- `apps/web/src/lib/upload-tracker.ts` (settleUploadTrackerClaim)
- `apps/web/src/lib/image-queue.ts` (background processing, mark-processed, cleanup)
- `apps/web/src/lib/data.ts` (publicSelectFields, searchImages, all public query functions, lines 1-1723)
- `apps/web/src/app/actions/topics.ts` (rename transaction fan-out)
- `apps/web/src/db/schema.ts` (all FK relationships)
- `apps/web/src/lib/serve-upload.ts` (ETag formula)
- `apps/web/src/lib/settings-hash.ts` (COLOR_IMPACTING_KEYS, hash computation)

Known false positive excluded per user instruction: `images.ts deleteOriginalUploadFile 'unguarded await leaks claim'` — refuted (swallows errors, confirmed in cycle 18 at `upload-paths.ts:76-79`).

---

## Flow 1: Upload Quota Claim Lifecycle

### Framing

Does every error path between the synchronous claim and the end of `uploadImages` settle the claim exactly once? Is there any double-settle or unrecovered leak?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All error paths settle exactly once — no leak, no double-settle | High | Strong | Verified settle sites at every early-exit and post-loop branch |
| 2 | A throw between per-file loop end and settle bypasses settlement | Low | Weak | No intermediate throwing code between loop and settle branches observed |
| 3 | Double-settle on a retry or concurrent path | Very low | Weak | settleUploadTrackerClaim is not idempotent but no double-call path found |

### Evidence For

**Hypothesis 1 (all paths settle exactly once):**

`apps/web/src/lib/upload-tracker.ts:19-33` — `settleUploadTrackerClaim` adjusts the in-memory tracker by `(successCount - claimedCount)` and `(uploadedBytes - claimedBytes)`. Idempotent in the sense of being a no-op when the key is absent, but NOT idempotent on repeated calls for the same key — double-settling would mis-adjust the counters.

`apps/web/src/app/actions/images.ts:170-228` — claim is placed synchronously BEFORE any `await`, eliminating the TOCTOU race window (CR-16-01 fix).

Settle sites downstream of the claim (`images.ts`):

| Line | Path | Args |
|------|------|------|
| 244 | disk check — insufficient space | `(0, 0)` |
| 249 | disk check — `statfs` throw | `(0, 0)` |
| 273 | topic SELECT — DB throw (CR-17-1 fix) | `(0, 0)` |
| 277 | topic SELECT — row missing | `(0, 0)` |
| ~540-555 | all-failed path (zero successes) | `(0, 0)` |
| ~564 | success / partial-success path | `(actualSuccessCount, actualBytes)` |

`apps/web/src/app/actions/images.ts:590-592` — outer `finally` releases only `uploadContractLock`; settlement is explicitly absent (intentional: settle already fired on one of the above paths).

Per-file catch block at `images.ts:507-533` — does NOT settle. Safe because `deleteOriginalUploadFile` (`upload-paths.ts:76-79`) swallows both `fs.unlink` rejections via `.catch(() => {})` and always resolves. This is the KNOWN FALSE POSITIVE confirmed in cycle 18.

**Background queue is orthogonal.** Quota settlement happens in the server action before the queue job runs. `image-queue.ts:447-467` (conditional `UPDATE WHERE processed = false` + delete-during-processing cleanup via `deleteImageVariants(..., [])`) is a separate correctness domain that does not touch quota tracking.

### Evidence Against / Gaps

**Hypothesis 2:** No code between end of per-file loop and the all-failed/success branches was observed to throw. The only async operations in that region are the settle calls themselves, which are synchronous mutations of an in-memory Map.

**Hypothesis 3:** `settleUploadTrackerClaim` is called exactly once per upload action invocation. No retry loop or concurrent path was found that would cause a second call for the same key within the same action execution.

**Residual fragility (not a defect):** The per-file catch block depends on `deleteOriginalUploadFile` permanently remaining non-throwing. This invariant is enforced only by the code comment at `images.ts:511-519` and the implementation at `upload-paths.ts:76-79`. No automated test pins the "must never throw" contract.

### Rebuttal Round

**Best challenge:** The outer `finally` (lines 590-592) does not settle. If a future refactor adds an async step between the per-file loop and the settle calls that can throw, and that throw propagates past the per-file catch, the claim would leak.

**Why the leader stands:** No such code exists today. The settle branches (all-failed at ~540 and success at ~564) are the only code between the loop and the outer finally, and both are synchronous Map mutations that cannot throw.

### Verdict: CLEARED

**Informational finding:**
- ID: TRC19-F1-FRAG-01
- Severity: INFORMATIONAL
- Confidence: HIGH
- Location: `apps/web/src/app/actions/images.ts:511-519` (comment) + `apps/web/src/lib/upload-paths.ts:76-79`
- Issue: Per-file catch block invariant ("settle not called here because deleteOriginalUploadFile never rejects") enforced only by a code comment, not an automated test. A future change making `deleteOriginalUploadFile` reject would silently break the invariant.

---

## Flow 2: Public Request Privacy — publicSelectFields / searchFields

### Framing

Can any admin-only/PII column (`latitude`, `longitude`, `filename_original`, `user_filename`, `transfer_function`, `color_pipeline_decision`, etc.) reach a public API response via the main listing, search, semantic search, or similar-image enrichment selects?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | No PII column reaches a public response — compile-time guards enforce this on all guarded paths | High | Strong | Two independent compile-time guards, both verified in source |
| 2 | Semantic search enrichment select bypasses both guards, enabling future PII drift | Medium | Moderate | Route confirmed clean today; structural gap acknowledged from cycle 18 |
| 3 | getMapImages exposes lat/lon to unauthenticated visitors without an opt-in check | Very low | Weak | Disconfirmed: SQL join + runtime double-check both verified |

### Evidence For

**Hypothesis 1 (no PII leak via guarded paths):**

`apps/web/src/lib/data.ts:365-397` — `publicSelectFields` derived by destructuring `adminSelectFields` and assigning omitted fields to `_omit*` variables. Omitted columns confirmed: `latitude`, `longitude`, `filename_original`, `user_filename`, `color_pipeline_decision`, `transfer_function`, `matrix_coefficients`, `bit_depth`, `uploaded_by`, `processing_error`, `failed_at`, `color_space`, `icc_profile_name`, `pipeline_version`, `is_hdr`, `has_gain_map`, `was_downscaled`.

`apps/web/src/lib/data.ts:461-465` — compile-time guard `_privacyGuard`:
```typescript
type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFieldCore, _PrivacySensitiveKeys>;
const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [...] = true;
```
Any `_PrivacySensitiveKeys` member present in `publicSelectFieldCore` causes a `tsc` error at build time.

`apps/web/src/lib/data.ts:1500-1504` — `searchImages` uses a custom `searchFields` object (not `publicSelectFields`) and carries its own compile-time guard:
```typescript
type _SearchSensitive = Extract<keyof typeof searchFields, _PrivacySensitiveKeys>;
const _searchPrivacyGuard: _SearchSensitive extends never ? true : [...] = true;
```
This guard was added specifically because `searchFields` was the one public select set without a compile-time privacy guard (R15C15/A15-02 fix). The current `searchFields` columns: `id`, `title`, `description`, `filename_jpeg`, `width`, `height`, `topic`, `topic_label`, `camera_model`, `lens_model`, `capture_date`, `created_at` — no GPS, no `filename_original`, no PII.

`apps/web/src/lib/data.ts:773-985` — `getImagesLite`, `getImagesLitePage`, `getImages`, all use `publicSelectFields`.

`apps/web/src/lib/data.ts:1231-1322` — `getSharedGroup` uses `publicSelectFields`.

`apps/web/src/lib/data.ts:1398-1430` — `getImagesForSmartCollection` uses `publicSelectFields`.

`apps/web/src/lib/data.ts:1629-1665` — `getMapImages` intentionally exposes `latitude`/`longitude` via `publicMapSelectFields`, but behind:
1. SQL: `INNER JOIN topics WHERE topics.map_visible = true AND latitude IS NOT NULL AND longitude IS NOT NULL` — only admin-opted-in topics.
2. Runtime (lines 1657-1663): throws if any returned row has `topic_map_visible !== true`. Defense-in-depth against future weakened JOIN conditions.

**Semantic and similar-image routes (from cycle 18, confirmed clean as of that reading):**

Cycle 18 Flow 4 confirmed both `api/search/semantic/route.ts` (enrichment at lines 293-315) and `api/search/similar/[id]/route.ts` (enrichment at lines 195-215) select: `id`, `title`, `description`, `filename_jpeg`, `width`, `height`, `topic`, `topic_label`, `camera_model`, `lens_model`, `capture_date`. No PII column appears.

The structural risk acknowledged in cycle 18 (A2): these enrichment selects bypass the compile-time `_PrivacySensitiveKeys` guard. If a developer adds a PII column to these selects, tsc will NOT catch it.

### Evidence Against / Gaps

**Hypothesis 2 (structural gap):** The semantic and similar enrichment selects are confirmed clean today, but there is no compile-time guard on those paths. A future PII column added to either route without also adding it to the cycle-16 regex denylist fixture would silently leak. This structural smell was acknowledged in cycle 18 as deferred (A2).

**Hypothesis 3:** Disconfirmed. `map_visible` requires explicit per-topic admin opt-in, enforced at both SQL and runtime layers.

### Rebuttal Round

**Best challenge:** `searchImages` uses `searchFields` (not `publicSelectFields`) with its own guard. But what if the `_searchPrivacyGuard` itself has a bug — for example, if `_PrivacySensitiveKeys` is not exhaustive?

**Why the leader stands:** `_PrivacySensitiveKeys` is a union type derived from the same `_omit*` variables used in `publicSelectFields` construction. Any column removed from `publicSelectFields` is automatically covered in `_PrivacySensitiveKeys`. The two guards are anchored to the same source of truth.

### Verdict: CLEARED (structural A2 gap acknowledged, deferred from cycle 18)

**Structural finding (not a live defect):**
- ID: TRC19-F2-STRUCT-01
- Severity: LOW (structural smell, future drift risk)
- Confidence: HIGH
- Location: `apps/web/src/app/api/search/semantic/route.ts:293-315` and `apps/web/src/app/api/search/similar/[id]/route.ts:195-215`
- Issue: Enrichment selects in both routes bypass the `_PrivacySensitiveKeys` compile-time guard. New PII columns added to these selects would not be caught by tsc. Only the cycle-16 regex denylist fixture acts as guard.
- Fix: Refactor both enrichment selects to use `publicSelectFields` (or a `publicEnrichmentFields` derived from it) so the compile-time guard covers these paths.

---

## Flow 3: Topic Slug Rename — Fan-out Completeness and Transaction Safety

### Framing

Does the rename transaction re-point every FK reference to `topics.slug` before deleting the old slug row? Is there any reference not covered by the fan-out that could produce an orphan or FK violation?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | All FK references covered; transaction is atomically safe | High | Strong | Schema enumerated all FK children; transaction fan-out confirmed |
| 2 | Concurrent upload to old slug races the transaction DELETE, causing FK RESTRICT violation | Low | Moderate | Real structural race; no cross-lock coordination between upload and rename advisory locks |
| 3 | sharedGroups or sharedGroupImages have an undiscovered FK to topics.slug | Very low | Weak | Disconfirmed by full schema.ts read |

### Evidence For

**Hypothesis 1 (complete fan-out):**

Complete FK child enumeration from `apps/web/src/db/schema.ts`:

| Table | Column | onDelete | In fan-out? |
|-------|--------|----------|-------------|
| `topicAliases` | `topicSlug` | `cascade` | Yes — `tx.update(topicAliases)` |
| `images` | `topic` | `restrict` | Yes — `tx.update(images)` |
| `topicViews` | `topic` | `cascade` | Yes — `tx.update(topicViews)` |
| `smartCollections` | `query_json` | (JSON, no FK) | Yes — AST remap loop |

No other table has an FK to `topics.slug`. Confirmed absent:
- `sharedGroups` (lines 138-146): no FK to topics
- `sharedGroupImages` (lines 148-155): FKs to `sharedGroups.id` and `images.id` only
- `imageViews` (lines 222-233): FK to `images.id` only
- `imageEmbeddings` (lines 271-286): FK to `images.id` only

`apps/web/src/app/actions/topics.ts:249-331` — transaction order (within one `db.transaction`):
1. `tx.insert(topics)` — new slug row created first
2. `tx.update(images)` — moves all `images.topic` FK references to new slug
3. `tx.update(topicAliases)` — moves all `topicAliases.topicSlug` FK references
4. `tx.update(topicViews)` — moves all `topicViews.topic` FK references
5. Smart collections AST remap loop — JSON update for `eq`/`in` predicates
6. `tx.delete(topics)` — deletes old slug row last

After step 4, no rows in any FK-constrained table reference the old slug. The `onDelete: 'cascade'` on `topicAliases` and `topicViews` is a no-op at step 6. The `onDelete: 'restrict'` on `images.topic` is satisfied because step 2 moved all image rows.

Transaction is serialized by advisory lock `gallerykit_topic_route_segments`.

### Evidence Against / Gaps

**Hypothesis 2 (concurrent upload race):**

Upload action holds `gallerykit_upload_processing_contract`. Topic rename holds `gallerykit_topic_route_segments`. These are different advisory locks — no cross-coordination.

In MySQL InnoDB, `tx.update(images) WHERE topic = oldSlug` (step 2) acquires row-level locks on existing matching rows. A concurrent INSERT with `topic = oldSlug` would need a shared lock on the `topics` row for oldSlug (FK validation) before inserting. The rename transaction holds this row in exclusive lock (step 6 upcoming DELETE). The INSERT would block until the transaction commits or rolls back.

If the rename commits first: INSERT fails FK constraint (oldSlug no longer in topics). Upload action returns an FK error to the user.
If the INSERT wins the race before step 2 locks the row: the INSERT succeeds, the rename's step 6 DELETE fails `onDelete: 'restrict'`, the rename rolls back and returns an error.

**In both cases:** no silent orphan, no silent data corruption. One of the two operations fails with a user-visible error. The rename or upload is retriable. This is a UX issue, not a data-integrity defect, and is consistent with single-writer topology expectations.

**Hypothesis 3:** Disconfirmed by full `schema.ts` read.

### Rebuttal Round

**Best challenge:** The `topicViews` cascade at DELETE time. If step 4 updates all topicViews to new slug but a concurrent view INSERT creates a new `topicViews` row with the old slug between steps 4 and 6, the cascade at step 6 would DELETE that new analytics row silently.

**Why this is acceptable:** `topicViews` are best-effort analytics events (documented in CLAUDE.md: "written by per-IP-rate-limited but otherwise anonymous public endpoints"). A tiny window of analytics-event loss during a topic rename is acceptable for a personal gallery. This is not product data. The rename transaction is correct from a relational integrity standpoint.

### Verdict: CLEARED

**Informational finding:**
- ID: TRC19-F3-INFO-01
- Severity: LOW
- Confidence: MEDIUM
- Location: `apps/web/src/app/actions/topics.ts:249-331` vs. `apps/web/src/app/actions/images.ts` (upload action)
- Issue: Concurrent upload to oldSlug during topic rename can cause either the rename DELETE (FK RESTRICT on images) or the upload INSERT (FK on topics) to fail, rolling back that operation. No data corruption; both operations are retriable. No cross-advisory-lock coordination prevents this race.

---

## Flow 4: ETag/Cache Invalidation — Color/Quality/Size Setting Flip

### Framing

When an admin flips a `COLOR_IMPACTING_KEYS` setting, does the ETag invalidation correctly distinguish between the serve-upload path and the static (Next.js) path? Does the implementation match the documented CRT-D1 gotcha?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | serve-upload path correctly invalidates; static path does NOT — matches CRT-D1 documented design | High | Strong | ETag formula, COLOR_IMPACTING_KEYS, and hash computation all verified from source |
| 2 | COLOR_IMPACTING_KEYS is missing a byte-impacting setting — silent stale-cache on change | Low | Moderate | Compile-time guard validates existing keys but cannot catch omitted NEW keys |
| 3 | Hash collision produces false 304s on a setting flip | Very low | Negligible | SHA-256 prefix at 8 hex chars; 2^32 space; negligible for this load |

### Evidence For

**Hypothesis 1 (correct behavior matching CRT-D1):**

`apps/web/src/lib/serve-upload.ts:214-215` — ETag formula (verified from source):
```
const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;
```

`apps/web/src/lib/settings-hash.ts:45-57` — `COLOR_IMPACTING_KEYS` (9 keys, verified):
```
wide_gamut_jpeg_chroma, sdr_jpeg_chroma, avif_effort,
force_srgb_derivatives, wide_gamut_max_source_pixels,
image_quality_webp, image_quality_avif, image_quality_jpeg,
image_sizes
```

`apps/web/src/lib/settings-hash.ts:66-68` — compile-time guard:
```typescript
type _ColorKeysAreSettingKeys =
    (typeof COLOR_IMPACTING_KEYS)[number] extends GallerySettingKey ? true : never;
```
Catches typos and removed keys. Cannot catch a new byte-impacting setting not added to the list (documented caveat at lines 62-65).

`apps/web/src/lib/settings-hash.ts:92-105` — `buildHashFromConfig` uses RESOLVED `GalleryConfig` values (R8-H1: prevents ETag misalignment when invalid DB values are stored). Sorts `image_sizes` ascending before hashing (line 102): `[...config.imageSizes].sort((a, b) => a - b).join(',')` — prevents spurious invalidation when order differs (AGG-R7C3-02).

`apps/web/src/lib/serve-upload.ts:46-83` — `getServingColorSettingsHash()`: module-scoped 5-second stale-while-revalidate cache. Prevents per-request DB reads on image-serving hot paths; stale hash served immediately on refresh then updated in background.

**Static path behavior confirming CRT-D1:**

Next.js static serving (`public/uploads/`) emits ETag format `W/"{size-hex}-{mtime-hex}"` — does NOT include the settings hash. Flipping a COLOR_IMPACTING_KEYS setting does NOT change static derivatives' on-disk bytes, so mtime and size are unchanged, so the static ETag is unchanged. Clients with static ETags continue to receive 304 until a backfill re-encode rewrites the files.

This exactly matches CLAUDE.md CRT-D1 documented operational gotcha: "flipping a color/quality/size admin setting does NOT invalidate already-served STATIC derivatives (the on-disk bytes — and therefore the mtime+size ETag — are unchanged until a re-encode). The settings-hash ETag only affects the serve-upload path."

### Evidence Against / Gaps

**Hypothesis 2 (incomplete COLOR_IMPACTING_KEYS):** At current pipeline version 7, the 9-key list matches the CLAUDE.md-documented enumeration and is consistent with the known byte-impacting settings. The gap is process (checklist), not implementation. The compile-time guard at `settings-hash.ts:66-68` enforces non-removal but not non-omission of new keys.

**Hypothesis 3:** Negligible. SHA-256 collision probability for 32-bit prefix across distinct setting combinations is effectively zero for a personal gallery's change frequency.

### Rebuttal Round

**Best challenge:** The 5-second stale-while-revalidate window in `getServingColorSettingsHash()` means a setting flip takes up to 5 seconds to reach the ETag on the serve-upload path. During this window, stale ETags are issued.

**Why this is acceptable:** The serve-upload path is the minority traffic path — Next.js static serving handles existing files. The stale window is bounded at 5 seconds. The alternative (per-request DB read) would severely impact image-serving hot paths. This is an explicit documented trade-off (R4C3 PERF-R4C3-05).

### Verdict: CLEARED

Implementation exactly matches the CRT-D1 documented design. No defects.

---

## Summary of Flow Verdicts

| Flow | Verdict | Key Evidence Anchors |
|------|---------|---------------------|
| 1 — Upload quota claim | CLEARED | Settle at `images.ts:244,249,273,277,~540,~564`; `deleteOriginalUploadFile` hardened (`upload-paths.ts:76-79`); outer finally does not settle (intentional) |
| 2 — Privacy / public routes | CLEARED | `publicSelectFields` compile-time guard at `data.ts:461-465`; `searchFields` guard at `data.ts:1500-1504`; semantic/similar routes confirmed clean (cycle 18); structural A2 gap deferred |
| 3 — Topic slug rename fan-out | CLEARED | All FK children covered (`images`, `topicAliases`, `topicViews`, `smartCollections.query_json`); `sharedGroups`/`sharedGroupImages` have no FK to `topics.slug`; atomic transaction with advisory lock |
| 4 — ETag/cache invalidation | CLEARED | ETag formula at `serve-upload.ts:214-215`; 9-key `COLOR_IMPACTING_KEYS` at `settings-hash.ts:45-57`; `image_sizes` sorted before hashing at `settings-hash.ts:102`; matches CRT-D1 gotcha |

---

## Findings

- **TRC19-F1-FRAG-01** | INFORMATIONAL | HIGH confidence | `apps/web/src/app/actions/images.ts:511-519` + `apps/web/src/lib/upload-paths.ts:76-79` — Per-file catch block depends on `deleteOriginalUploadFile` never rejecting; invariant enforced by code comment only, not an automated test.

- **TRC19-F2-STRUCT-01** | LOW | HIGH confidence | `apps/web/src/app/api/search/semantic/route.ts:293-315` and `apps/web/src/app/api/search/similar/[id]/route.ts:195-215` — Enrichment selects bypass `_PrivacySensitiveKeys` compile-time guard; future PII addition would not be caught by tsc. Clean today; structural drift risk. (Carry-over of cycle-18 A2.)

- **TRC19-F3-INFO-01** | LOW | MEDIUM confidence | `apps/web/src/app/actions/topics.ts:249-331` — Concurrent upload to oldSlug during topic rename can cause one operation to fail FK constraint and roll back. No data corruption; retriable. No cross-advisory-lock coordination.

---

## Critical Unknowns

1. **Flow 2 structural gap:** Whether the semantic/similar enrichment selects will remain clean as new columns are added. The compile-time guard does not cover these paths.

2. **Flow 1 fragility:** Whether `deleteOriginalUploadFile` will remain permanently non-throwing across future refactors. Currently correct; no test enforcement.

## Discriminating Probes

1. **Structural PII guard (Flow 2):** `grep -rn "latitude\|longitude\|filename_original\|user_filename" apps/web/src/app/api/search/` — any hit is a new live PII leak. Run on every search-route change.

2. **deleteOriginalUploadFile invariant (Flow 1):** Read `apps/web/src/lib/upload-paths.ts` and verify `.catch(() => {})` is present and unconditional on both `fs.unlink` calls. Consider adding a JSDoc `@throws never` annotation or a test that verifies the function resolves even when `unlink` fails.
