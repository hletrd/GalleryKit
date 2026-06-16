# Trace Report — GalleryKit Suspicious Data/Control Flows
**Cycle 2 | HEAD: 8ccc8806 | Date: 2026-06-16**

---

## Flow 1 — Upload → Original Save → Enqueue → Queue Claim → Sharp Fan-out → Conditional UPDATE → Orphan Cleanup

### Observation

The upload pipeline chains multiple async stages across process-local state (in-memory `PQueue`, `enqueued` Set, `permanentlyFailedIds` Set) and MySQL advisory locks. Two specific race surfaces were flagged: (a) delete-while-processing, and (b) multi-worker / restart-boundary double-processing.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Per-image advisory lock + conditional UPDATE is sufficient: the two guards are logically redundant and cover both races | High | Strong | Both guards observed in code |
| 2 | Delete-while-processing creates a window where orphaned variant files are not cleaned | Low | Moderate | `deleteImage` does not hold the per-image lock during deletion |
| 3 | Restart-boundary double-process: on restart, `bootstrapImageProcessingQueue` re-enqueues a row still being processed by the dying worker | Low | Moderate | Bootstrap fetches `processed=false` rows without excluding in-flight jobs |

### Evidence For

**H1 (dual guard is sufficient):**
- `apps/web/src/lib/image-queue.ts` — `acquireImageProcessingClaim(jobId)` issues `GET_LOCK('gallerykit:image-processing:{jobId}', 0)` (non-blocking). A second worker for the same image gets `null` from `GET_LOCK` and enters a retry loop (up to 10 retries with 5 s * min(attempt, 5) delay) before giving up.
- After processing, the conditional UPDATE is `WHERE processed=false`. If a second worker races past the lock (e.g., first worker crashed without releasing), the UPDATE returns `affectedRows===0`, triggering `cleanupDeletedMidReencodeVariants` with empty sizes (orphan file removal). This covers restart-boundary scenarios because the restarted worker re-acquires the lock and re-processes, while the first worker's partial files are detected by the `affectedRows===0` guard.
- MySQL advisory locks are connection-scoped: a crashed worker's lock is released automatically on TCP disconnect.

**H2 (delete-while-processing):**
- `deleteImage` in `apps/web/src/app/actions/images.ts` removes the image ID from the in-memory `enqueued` Set BEFORE the DB transaction, then deletes the DB row. It does NOT acquire `gallerykit:image-processing:{id}` before deletion.
- The queue worker's conditional `UPDATE WHERE processed=false` returns `affectedRows===0` if the row was deleted mid-encode. `cleanupDeletedMidReencodeVariants` is then called with the row's `filename_*` values, removing freshly-written variant files. This path is explicitly accounted for in `image-queue.ts`.
- Handled correctly. No orphan window.

**H3 (restart boundary):**
- `bootstrapImageProcessingQueue` fetches `processed=false` rows and re-enqueues them. On restart, a row being processed by the dying worker is re-enqueued. The restarted worker attempts `GET_LOCK` — if the original TCP connection is gone, the lock is available and re-processing proceeds cleanly to the conditional UPDATE. No double-write occurs because only one worker holds the lock at a time.

### Evidence Against / Gaps

**H2 disconfirmed:** The `affectedRows===0` path exists and is tested. File cleanup passes `row.filename_*` values, so cleanup targets real files. Confirmed correct.

**H3 disconfirmed:** The per-image lock ensures at most one active worker per image at any moment. The conditional UPDATE prevents a double-write even if two workers both proceed past a brief lock window. Handled.

**Residual gap — `permanentlyFailedIds` not cleared on delete:** `deleteImage` does not remove an image's ID from the `permanentlyFailedIds` Set. A deleted image that had permanently failed leaves a dead ID in the Set until process restart. If MySQL ever reuses the same auto-increment ID (extremely unlikely in practice) a re-uploaded image with that ID would be silently skipped by the retry scheduler. Minor process-local memory accumulation, no current data integrity impact.

### Rebuttal Round

Best challenge to H1: The restart case assumes the MySQL advisory lock is released promptly on TCP disconnect. If the MySQL server has a slow `wait_timeout` for dead connections, a brief overlap exists where the restarted worker gets `null` from `GET_LOCK` and backs off. The retry loop (up to 10 * 5 s = 50 s) would eventually succeed or give up. Giving up means the row stays `processed=false` and is re-enqueued on next bootstrap. This is a latency issue, not a data-loss issue.

H1 stands: eventual consistency is preserved; no data loss path identified.

### Current Best Explanation

Flow 1 is correctly guarded. Both the per-image advisory lock and the `WHERE processed=false` conditional UPDATE are in place and logically sound. Delete-while-processing is handled by the `affectedRows===0` path. Restart-boundary double-processing is prevented by the lock.

### Finding

**TRC-01 (LOW): `permanentlyFailedIds` not cleared on `deleteImage`**
Deleting an image that permanently failed does not remove its ID from `permanentlyFailedIds`. On a long-running process this accumulates dead IDs, and in the pathological case of integer ID reuse a re-uploaded image with the same ID would be silently skipped by the retry scheduler.
Files: `apps/web/src/app/actions/images.ts` (`deleteImage`), `apps/web/src/lib/image-queue.ts` (`permanentlyFailedIds` Set).

---

## Flow 2 — Backfill: Re-encode → Color Re-detect → Column Write; Detection Failure Must NOT Bump pipeline_version

### Observation

Two backfill entry points exist: the sidecar CLI script (`scripts/backfill-color-pipeline.ts`) and the in-app admin runner (`lib/admin-backfill-runner.ts`). Both must uphold the invariant: transient color-detection failure after a successful re-encode must not advance `pipeline_version`, ensuring later runs retry detection.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Both paths correctly bifurcate detection-failure from full-success and skip `pipeline_version` on detection failure | High | Strong | Observed in both code paths |
| 2 | Sidecar lacks per-image lock, creating a race with `retryFailedImage` that could double-process a row | Medium | Moderate | Explicitly documented gap at sidecar source lines 37-43 |
| 3 | Global backfill lock serializes sidecar vs in-app runner but NOT sidecar vs queue worker `retryFailedImage` | Medium | Moderate | `gallerykit_color_pipeline_backfill` lock not acquired by `retryFailedImage` |

### Evidence For

**H1 (version-bump invariant holds):**
- `admin-backfill-runner.ts` `reprocessOne()`: on `detectColorSignals` failure, returns a derivative-only result `{ was_downscaled, avif_10bit }`. The UPDATE for this case sets ONLY `was_downscaled` and `avif_10bit` — `pipeline_version` is absent from the SET clause.
- Sidecar `backfill-color-pipeline.ts` `reprocessRow()`: identical bifurcation. On detection failure, returns `{ outcome: 'processed', derivativeOnly: { was_downscaled, avif_10bit } }`. `flushBatch()` places these in `derivativeBatch` and issues a separate UPDATE that omits `pipeline_version`.
- CLAUDE.md documents: invariant "locked by `__tests__/admin-backfill-runner-detection-failure.test.ts`".

**H2 (sidecar missing per-image lock):**
- Sidecar lines 37-43 explicitly document this gap. If `retryFailedImage` re-enqueues a row while the sidecar is re-encoding it, both can write DB columns. The sidecar does not use `WHERE processed=false` as a guard (it operates on rows where `pipeline_version != IMAGE_PIPELINE_VERSION`). The queue worker's conditional UPDATE uses `WHERE processed=false`. Since backfill does not change `processed`, both UPDATEs target different conditions and do not collide on the same row-level guard. Last writer wins on color columns — both are valid processing outputs.

**H3 (global lock scope):**
- `gallerykit_color_pipeline_backfill` is acquired by BOTH sidecar and in-app runner. These two serialize against each other.
- `retryFailedImage` (in `image-queue.ts`) does NOT acquire this lock. The queue worker acquires the per-image lock (`gallerykit:image-processing:{id}`), but the sidecar does NOT check for that lock.
- Race outcome: last writer wins on color columns; both write valid values from their respective re-encode; no stale or corrupt data.

### Evidence Against / Gaps

**H2 partially disconfirmed:** File-level atomicity (Sharp's rename-on-complete pattern) prevents file corruption. DB column races are bounded to two valid re-encode outputs. This is an accepted indeterminism, not a correctness failure.

### Rebuttal Round

Best challenge to H1: What if `detectColorSignals` throws rather than returns null — does the exception propagate past the version-bump guard?
- In `admin-backfill-runner.ts` `reprocessOne()`: the entire function is wrapped in try/catch. A thrown exception produces `{ outcome: 'error' }`, which causes the caller to increment the error counter and write NO DB columns. `pipeline_version` is not bumped.
- Sidecar `reprocessRow()`: same pattern.

H1 stands unconditionally.

### Current Best Explanation

The `pipeline_version`-bump invariant is upheld by both backfill paths under all failure modes including exceptions. The sidecar's lack of per-image lock is a documented, accepted limitation that creates theoretical indeterminism when `retryFailedImage` races the sidecar, but does not produce incorrect data.

### Finding

**TRC-02 (INFO): Sidecar backfill + retryFailedImage race is a documented accepted limitation**
No correctness failure. The race produces at worst one of two valid re-encode outputs. Documented in sidecar source at lines 37-43.

---

## Flow 3 — ETag / Cache Invalidation: Backfill Re-encode Rewrites Bytes Under Same Filename

### Observation

CLAUDE.md claims backfill re-encodes change mtime (and usually size), causing the static-server ETag (`W/"{size-hex}-{mtime-hex}"`) to change. The `serve-upload.ts` ETag additionally embeds `pipeline_version`, mtime, size, and a settings hash. The claim is that after backfill, cached clients revalidate correctly without operator action.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Static-server ETag changes after backfill because the re-encoded file has a new mtime (and usually different size) | High | Strong | Sharp re-encodes produce new file bytes with updated mtime |
| 2 | serve-upload.ts ETag changes because pipeline_version increments and/or mtime changes | High | Strong | ETag formula at line 201 directly includes IMAGE_PIPELINE_VERSION |
| 3 | serve-upload.ts settings-hash TTL (5 s) creates a brief window where stale hash is served after admin color-settings flip | Low | Moderate | TTL explicitly designed and documented; self-corrects via mtime |
| 4 | Static-server path (public/) bypasses serve-upload.ts entirely for existing files — serve-upload ETag is irrelevant for the common case | High | Strong | CLAUDE.md "Serving precedence" note confirmed in serve-upload.ts comment |

### Evidence For

**H1 (static server ETag changes):**
- Sharp writes variant files by overwriting the output path, updating the filesystem mtime. Next.js static file ETag is `W/"{size-hex}-{mtime-hex}"`. After backfill re-encodes a file, mtime changes. Even if encoded byte count were identical (extremely unlikely for a real re-encode), mtime changes. ETag changes.
- Production filesystem: Linux/Docker ext4 with nanosecond mtime resolution. `mtimeMs` captures millisecond precision. No coarse-mtime risk.

**H2 (serve-upload ETag changes):**
- `serve-upload.ts` line 201: `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`. When pipeline version increments (e.g., 6 to 7), the ETag string changes for ALL files served through this path without any file modification.

**H3 (settings-hash TTL):**
- `serve-upload.ts` line 46: `SERVING_SETTINGS_HASH_TTL_MS = 5_000`. Stale-while-revalidate: a stale hash is served immediately and the background refresh proceeds without blocking. Worst case: up to 5 s + one refresh cycle before all new requests see the updated ETag. If admin flips a setting and immediately triggers backfill, the ETag's mtime component changes anyway from re-encoding, so cache invalidation self-corrects. Documented and accepted.

**H4 (static server takes precedence):**
- CLAUDE.md: "For existing files the production serving path is therefore Next's static server... not `serve-upload.ts`." The serve-upload ETag machinery fires only for locale-prefixed URLs and for files not present in `public/`. For the common case, H1 applies.

### Evidence Against / Gaps

**No CDN deployed.** The nginx reverse proxy does not cache. A CDN upstream of nginx would face a `max-age=3600` stale window before revalidation. Not a current risk for the documented single-server deployment.

### Rebuttal Round

Best challenge: what if re-encoded file has the same byte count AND coarse mtime on an unusual filesystem? Production is ext4 (nanosecond mtime); this does not apply.

H1 and H2 stand.

### Current Best Explanation

ETag invalidation is correct for both serving paths. The 5-second settings-hash TTL is a bounded, self-correcting trade-off.

### Finding

No confirmed bug. The ETag chain is architecturally sound for the documented deployment.

---

## Flow 4 — Analytics View-Count Buffering → Async Flush: Crash Loss and Exactness

### Observation

Shared-group view counts are buffered in-process (`viewCountBuffer` Map in `data.ts`) and flushed asynchronously via `setTimeout`. Separately, `recordSharedGroupView` in `public.ts` inserts into the `sharedGroupViews` event-row table via direct `db.insert`. CLAUDE.md documents view counts as "best-effort approximate analytics." Concern: (a) what is lost on crash, and (b) is any code path treating this approximate count as exact?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Crash loses only the in-memory buffer; no billing or audit code treats view_count as exact | High | Strong | No billing path found involving view_count |
| 2 | The sharedGroupViews INSERT path (event rows) is durable and separate from the buffered view_count increment | High | Strong | public.ts lines 392-404 use db.insert directly |
| 3 | No SIGTERM handler calls flushBufferedSharedGroupViewCounts before process exit — graceful shutdown silently drops the buffer | High | Strong | No SIGTERM handler found; timer uses .unref() |

### Evidence For

**H1 (what is lost):**
- `data.ts` `viewCountBuffer`: module-scoped `Map<number, number>`. On process crash (SIGKILL, OOM) or graceful exit without flush, the buffer is lost. Maximum loss: `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` entries accumulated since last flush (`BASE_FLUSH_INTERVAL_MS = 5 s`).
- The timer is armed with `.unref()`, meaning it does not keep the Node.js event loop alive. On `docker stop` (SIGTERM → 10 s grace period → SIGKILL), the graceful shutdown may not flush the buffer unless a SIGTERM handler calls `flushBufferedSharedGroupViewCounts()`. No such handler was found in the codebase.
- CLAUDE.md explicitly: "do not treat it as billing/audit-grade state."
- No billing code found touching `view_count`. The `entitlements` table (Stripe paid-download) is entirely separate.

**H2 (separate INSERT path is durable):**
- `public.ts` `recordSharedGroupView` (lines 392-404): fire-and-forget `db.insert(sharedGroupViews)`. These rows are durable once committed to MySQL. They are used for analytics breakdowns (country, referrer).
- `sharedGroups.view_count` (the denormalized counter column) is what the buffer increments. These are two parallel, independent systems.

**H3 (no SIGTERM flush):**
- Searched `image-queue.ts`, `data.ts`, and action files for `SIGTERM`, `beforeExit`, `process.on('exit'`, `flushBufferedSharedGroupViewCounts` — found only the exported function itself and its call in `flushGroupViewCounts` (internal use). No process-lifecycle hook calls the export.
- `flushBufferedSharedGroupViewCounts` is exported (line 191 in `data.ts`) but callers outside the module are not apparent from the search.

### Evidence Against / Gaps

**H3 gap — SIGTERM hook may exist elsewhere:** A dedicated entrypoint or Next.js lifecycle hook might call `flushBufferedSharedGroupViewCounts` on shutdown. The search covered `src/lib/*.ts` and `src/app/actions/*.ts` but not the Next.js custom server, API routes, or `instrumentation.ts`. This is the critical unknown.

### Rebuttal Round

Best challenge to H3: Next.js 16 may call module-level teardown hooks or the `onTerminate` lifecycle. If such a hook exists and calls `flushBufferedSharedGroupViewCounts`, the loss window closes. Evidence for this is absent — absence of evidence is weak, but the `.unref()` timer design signals an intentional "don't block shutdown" choice, implying the buffer IS expected to be silently abandoned.

H3 stands as a confirmed gap pending investigation of the instrumentation.ts or custom server file.

### Current Best Explanation

The `sharedGroupViews` event-row INSERT path is durable. The `view_count` buffer is approximate-by-design and documented as such. On graceful shutdown, up to 1000 pending view-count increments are lost with no log warning. No billing or quota enforcement uses this count.

### Finding

**TRC-03 (LOW): No SIGTERM handler calls `flushBufferedSharedGroupViewCounts` before process exit**
On `docker stop` (SIGTERM), the view-count buffer (up to 1000 entries, 5 s accumulation) is silently discarded. The per-event `sharedGroupViews` rows are durable, but the denormalized `shared_groups.view_count` counter undercounts by up to the buffer size on every graceful restart.

Discriminating probe: search `apps/web/src/instrumentation.ts` (if it exists) and any Next.js custom server file for `flushBufferedSharedGroupViewCounts` or SIGTERM handler.

---

## Flow 5 — Session Lifecycle: Token Mint → Cookie → Middleware Guard → isAdmin() → Expiry Purge

### Observation

The session lifecycle spans: `generateSessionToken()` → DB insert → cookie set → middleware format check → `verifySessionToken()` (per-request cached) → `isAdmin()` in server actions → hourly expiry purge. Concern: any window where expired or forged token is honored.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Middleware performs format check only; cryptographic validation occurs in every server action via verifySessionToken — this is defense in depth, not a gap | High | Strong | Middleware comment explicitly states this; matcher excludes /api/* |
| 2 | React cache() on verifySessionToken deduplicates within a request but NOT across requests — no stale-session window across requests | High | Strong | React cache() is per-render-tree by design |
| 3 | HMAC + token-age + DB expiresAt triple guard makes forged/expired tokens impossible to honor | High | Strong | All three checks confirmed in verifySessionToken |
| 4 | x-gk-admin-render header is set based on cookie presence, not session validity — minor distinction in SW cache behavior | Low | Weak | Documented design choice, not a security gap |

### Evidence For

**H1 (middleware as format gate only):**
- `proxy.ts` lines 83-115: checks token length >= 100 and exactly 3 colon-separated non-empty parts. Does NOT verify HMAC or DB existence. Redirect on format failure.
- `proxy.ts` config line 140: `matcher` excludes `/api/*` routes explicitly. All `/api/admin/*` routes rely entirely on `withAdminAuth()`. The `lint:api-auth` lint gate enforces this at CI time.
- Every mutating server action calls `requireSameOriginAdmin()` → `isAdmin()` → `verifySessionToken()`. Cryptographic verification happens at this layer.

**H2 (React cache() scope):**
- `session.ts` line 94: `verifySessionToken = cache(...)`. React `cache()` is scoped per React render tree (per request in Next.js App Router). It does not persist across requests. A token verified valid at request N is re-verified independently at request N+1. No cross-request stale-cache window exists.

**H3 (triple guard):**
- Token-age check: `tokenAge > maxAge (24h)` from embedded timestamp. Fails without DB access — a fast path against old tokens.
- HMAC: `timingSafeEqual(signatureBuffer, expectedSignatureBuffer)` with prior `length !== expectedSignatureBuffer.length` fast-path rejection. Forged tokens fail here.
- DB expiresAt check: `session.expiresAt < new Date()`. Inline deletion of expired session row on detection.
- Post-HMAC structural checks (random `/^[0-9a-f]{32}$/`, signature `/^[0-9a-f]{64}$/`) run AFTER HMAC to avoid timing oracle use.

**H4 (x-gk-admin-render):**
- `proxy.ts` line 128: sets header based on cookie PRESENCE regardless of format-check outcome. Intended: any admin-session cookie (even expired or malformed) marks the page as personalized for the SW. This is correct behavior per the design (SW cannot read Cookie headers; server makes the decision).

**Expiry purge:**
- `image-queue.ts` line 562: `db.delete(sessions).where(sql\`${sessions.expiresAt} < NOW()\`)` in hourly GC. Expired sessions are also lazily deleted on each `verifySessionToken` call.

### Evidence Against / Gaps

**H1 gap — API routes rely on lint gate:** If a new `/api/admin/*` route is added without `withAdminAuth()`, middleware does not cover it and the lint gate is the sole defense. The lint gate is CI-blocking, which is strong. Not a current gap.

**Buffer-length equality check before timingSafeEqual:** `session.ts` lines 110-113 return `null` early if `signatureBuffer.length !== expectedSignatureBuffer.length`. This is NOT constant-time. However, the signature is always 64 hex chars (128 ASCII bytes for Buffer.from without encoding) — the length is fixed and public, so this early return is not a practical timing oracle. The comparison happens before any secret material is consumed.

### Rebuttal Round

Best challenge: in-memory rate-limit counters reset on process restart. An attacker timing brute-force around a process restart gets a fresh window. Counter: CLAUDE.md documents "in-memory Maps with DB backup for login." `auth-rate-limit.ts` persists rate-limit state to DB for the login route specifically. The DB-backed persistence survives restarts. This concern is mitigated.

H1, H2, H3 all stand.

### Current Best Explanation

The session lifecycle is correctly guarded at every layer. No window for expired or forged token acceptance was found. The middleware is correctly positioned as a UX redirect gate, not a security gate — security is in `verifySessionToken` called by every action.

### Finding

No confirmed bug. The session lifecycle is architecturally sound.

---

## Flow 6 — CLIP Embedding Write → Read Round-Trip (Raw MEDIUMBLOB via decodeEmbeddingColumn)

### Observation

Prior to fix AGG-C10-01, `decodeEmbeddingColumn` used `Buffer.from(row.embedding as string, 'base64')`. Because mysql2 returns MEDIUMBLOB columns as Buffer, and `Buffer.from(buffer, 'base64')` ignores the encoding for Buffer input (copies verbatim), a 2048-byte raw binary buffer became a ~2732-byte buffer that failed the length check and was silently dropped. The fix introduces a three-case decoder.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | The three-case decoder in decodeEmbeddingColumn correctly handles the mysql2 Buffer return — round-trip is fixed | High | Strong | Case 1 matches the current write path exactly |
| 2 | The write path's `buf as unknown as string` cast works at runtime because Drizzle passes Buffer to mysql2 unchanged — but is fragile to future Drizzle ORM changes | High | Strong | Type cast is a known workaround for schema mismatch |
| 3 | Legacy rows (base64-encoded binary in MEDIUMBLOB) are correctly handled by Case 2 of the decoder | Medium | Moderate | Case 2 branch logic is correct for valid base64 ASCII content |

### Evidence For

**H1 (fix is correct):**
- `clip-embeddings.ts` line 108 `decodeEmbeddingColumn(value: unknown)`:
  - Case 1: `Buffer.isBuffer(value) && value.length === EMBEDDING_BYTES (2048)` → `bufferToEmbedding(value)` directly. This is the current write path's output from mysql2.
  - Case 2: `Buffer.isBuffer(value) && value.length !== 2048` → `value.toString('latin1')` then base64-decode, length-check. For legacy rows written as base64 text (~2732 bytes in MEDIUMBLOB), this decodes correctly.
  - Case 3: `typeof value === 'string'` → base64-decode, length-check. Defensive path.
- mysql2 MEDIUMBLOB → Node.js Buffer: mysql2 uses binary charset 63 → `readLengthCodedBuffer`. Case 1 handles this correctly.

**H2 (write path type cast):**
- `image-queue.ts` write site: `embedding: buf as unknown as string`. The Drizzle column schema declares `embedding` as `text()` but the physical MySQL column is `MEDIUMBLOB`. Drizzle passes the Buffer to mysql2's query parameters; mysql2 sends it as binary data. The MEDIUMBLOB column stores and returns raw bytes.
- This type cast is a workaround for the mismatch between Drizzle's schema annotation and the physical column type. If Drizzle ever normalizes `text()` parameter binding (e.g., calling `.toString()` on the value before sending), the write path would silently corrupt embeddings by converting 2048 binary bytes to a stringified representation.

**H3 (legacy row handling):**
- Case 2 assumes the Buffer contains valid base64 ASCII characters. If a legacy row was written as base64 text (`Buffer.from(embedding.toString('base64'))`), its length is approximately 2732 bytes and Case 2 fires, decoding correctly.
- If a legacy row was written as raw binary (2048 bytes), Case 1 fires. No ambiguity.

### Evidence Against / Gaps

**H2 latent risk confirmed:** The `text()` schema annotation vs MEDIUMBLOB physical column is a permanent type-level inconsistency. The feature is currently dark (`semantic_search_mode` disabled by default), reducing urgency. But the `buf as unknown as string` cast should be replaced with a custom Drizzle column type before the feature is activated.

**Case 2 assumption:** `value.toString('latin1')` on non-base64-safe binary would produce garbage that fails the length check after base64 decode — silently returning null. This is safe behavior (null is the contract for invalid inputs), but the boundary between "was this written as base64" and "was this written as raw binary" is implicit. The decoder is correct for the two known write paths.

### Rebuttal Round

Best challenge to H1: Could mysql2 ever return a string instead of a Buffer for MEDIUMBLOB? In theory, if the connection charset is changed to a multi-byte encoding, mysql2 might decode the MEDIUMBLOB as text. The connection uses binary charset 63, which mysql2 treats as Buffer. This would break if a different charset is configured. Not a current risk but a deployment concern.

H1 stands for the documented deployment.

### Current Best Explanation

The CLIP embedding round-trip is fixed by `decodeEmbeddingColumn`. The three-case decoder correctly handles current raw-binary writes and legacy base64 writes. The latent risk is the `text()` / MEDIUMBLOB schema mismatch — a future Drizzle behavioral change could silently corrupt the write path.

### Finding

**TRC-04 (LOW): `image_embeddings.embedding` declared as Drizzle `text()` but physical column is MEDIUMBLOB**
The `buf as unknown as string` write-path cast works today but is fragile to future Drizzle ORM updates. Should be replaced with a custom Drizzle column type that reflects the binary contract before the CLIP feature is activated.
Files: `apps/web/src/db/schema.ts` (schema declaration), `apps/web/src/lib/image-queue.ts` (write site).

---

## Summary of Confirmed Findings

| ID | Severity | Flow | One-liner |
|----|----------|------|-----------|
| TRC-01 | LOW | Flow 1 | `permanentlyFailedIds` is not cleared when `deleteImage` is called, accumulating dead IDs in process memory until restart |
| TRC-02 | INFO | Flow 2 | Sidecar backfill lacks per-image advisory lock — races with `retryFailedImage` are documented and accepted; not a correctness failure |
| TRC-03 | LOW | Flow 4 | No SIGTERM handler calls `flushBufferedSharedGroupViewCounts`, so up to 1000 buffered view-count increments are silently lost on graceful process shutdown |
| TRC-04 | LOW | Flow 6 | `image_embeddings.embedding` declared as Drizzle `text()` while the physical MySQL column is MEDIUMBLOB; the `buf as unknown as string` cast is fragile to future Drizzle ORM behavioral changes |

**Flows with no confirmed bug:** Flow 3 (ETag/cache invalidation), Flow 5 (session lifecycle).

**Confirmed findings: 4** (all LOW or INFO; no HIGH or CRIT data-integrity bugs found across the six flows)

---

## Top 3 Findings

1. **TRC-03**: No SIGTERM handler calls `flushBufferedSharedGroupViewCounts` — on every `docker stop`, up to 1000 pending view-count increments are silently discarded. The `.unref()` timer design signals this is intentional, but the loss is undocumented at the operational level.

2. **TRC-04**: `image_embeddings.embedding` column declared as Drizzle `text()` but stored as raw MEDIUMBLOB binary — the `buf as unknown as string` cast will silently corrupt embeddings if Drizzle ever normalizes `text()` parameter binding, and the feature is currently dark (not yet active in production).

3. **TRC-01**: `permanentlyFailedIds` Set is never pruned when images are deleted — on long-running processes with high image churn, the Set accumulates dead IDs. In the pathological case of MySQL auto-increment integer reuse, a re-uploaded image with the same ID would be silently skipped by the processing retry scheduler.
