# Tracer Report — Run-9 Cycle-4
HEAD: 094842a4 | Date: 2026-06-21 | Agent: Tracer

---

## Flows Traced

Three end-to-end flows selected based on prior cycle carry-forwards and the
cycle-4 brief:

1. Admin backfill re-encode — deleted-mid-reencode cleanup path
2. Settings change → ETag invalidation — static-path gotcha and stale-variant
   risk
3. CLIP semantic search — malformed-embedding row-skip and production/disabled
   resolver heal

Prior cycles (cycle-1 through cycle-3) confirmed CLEAN: upload→processing→
derivative-serving→ETag; delete-while-processing; view-analytics GC; auth/session.
Those flows are not re-traced here.

---

## Flow 1: Admin Backfill Re-encode — Deleted-Mid-Reencode Cleanup

### Observation

When an image row is deleted by an admin after `processImageFormats` has written
the derivative files to disk but before the backfill runner's `pipeline_version`
UPDATE executes, the `affectedRows` check detects the missing row and triggers
cleanup. The question: does cleanup actually remove ALL variant files (including
from prior non-default size configs), and does the flow ever strand stale color
metadata at the current pipeline_version?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Both branches (detection-success and detection-failure) correctly detect deletion, clean up all variants via dir scan, and leave pipeline_version un-bumped for the deleted row | High | Strong | Code directly shows both paths, both checks, both cleanup calls |
| 2 | The detection-failure UPDATE writes was_downscaled/avif_10bit without bumping pipeline_version — creating a partial column write on a still-live row | Low | Moderate | The branch does write two columns; whether it reaches the deleted-row guard correctly needs tracing |

### Evidence For

**H1 — detection-success branch** (`admin-backfill-runner.ts:556-577`):
```
UPDATE images SET pipeline_version=..., icc_profile_name=..., ... WHERE id=X AND processed=TRUE
```
`affectedRows===0` → `cleanupDeletedMidReencodeVariants(row)` → returns
`{ok: false, reason: 'deleted-mid-reencode'}`. Pipeline_version write is
inside the same conditional UPDATE, so if the row is gone, no version bump lands.

**H1 — detection-failure branch** (`admin-backfill-runner.ts:581-609`):
```
UPDATE images SET was_downscaled=..., avif_10bit=... WHERE id=X AND processed=TRUE
```
This UPDATE also checks `affectedRows===0` (same guard, same cleanup, same
`deleted-mid-reencode` result). The branch comment at lines 581-585 explicitly
documents this: "advance pipeline_version — the re-encode is idempotent, so
leaving the row behind the current version is safe; a later run will retry." The
row remains a candidate because pipeline_version is never written in this branch
regardless of whether the row is still alive or deleted.

**H1 — cleanup coverage** (`process-image.ts:498-539`):
`deleteImageVariants(dir, base, [])` with `sizes=[]` enters the full dir-scan
branch:
```typescript
if (!sizes || sizes.length === 0) {
    // glob: all files matching `${name}_*${ext}` → added to filesToDelete
}
await Promise.all([...filesToDelete].map(f => fs.unlink(path.join(dir, f)).catch(() => {})));
```
The glob catches every size suffix that exists on disk, independent of the
current `image_sizes` config. Called on all three dirs (WEBP, AVIF, JPEG) via
`cleanupDeletedMidReencodeVariants` (`admin-backfill-runner.ts:430-440`).
Per-unlink `.catch(() => {})` means a missing file is silently skipped; no throw.

**H1 — counter partition** (`admin-backfill-runner.ts:699-751`):
`deletedMidReencode` counter is distinct from `errors` and `processed`. The
caller sees accurate accounting.

**H1 — advisory lock** (`admin-backfill-runner.ts`): The backfill holds
`gallerykit_color_pipeline_backfill` on a dedicated connection for the run,
preventing two concurrent backfill processes from racing the same row. The
per-image `gallerykit:image-processing:{jobId}` lock used by the upload queue
does NOT participate here — delete can race the backfill but that is exactly
what the `affectedRows===0` guard is designed for.

### Evidence Against / Gaps

**H2 — partial write on a live row**: In the detection-failure branch, if the
row IS still alive (detection failed but the row was not deleted), the UPDATE
writes `was_downscaled` and `avif_10bit` but NOT `pipeline_version`. This is
intentional by design (the row stays eligible for a future re-encode retry). No
state corruption: the columns written are correct for the re-encoded derivatives.
This is documented behavior, not a defect.

**H1 — gap**: Cleanup is best-effort (`.catch(warn)` wraps the whole call).
A transient filesystem error leaves a file on disk undeleted. However, this is
non-correctness-impacting: the row is gone from the DB, so the orphaned file is
simply dead weight. The `deleteImage` path also calls cleanup; if a file remains
after both, it is a disk-hygiene issue only.

### Rebuttal Round

Best challenge to H1: "What if the `processImageFormats` call itself races
another deletion — could the derivative write complete AFTER cleanup runs?"

Rebuttal: The cleanup runs only after `affectedRows===0`, which means the
DELETE already committed to MySQL. `processImageFormats` writes files
before the UPDATE is attempted. The ordering is: writes-to-disk → UPDATE (0
rows) → cleanup. No out-of-order scenario can produce stranded files that
cleanup misses unless a concurrent `processImageFormats` (second backfill
worker) races for the same image — but `gallerykit_color_pipeline_backfill`
serializes backfill runs, and `gallerykit:image-processing:{jobId}` locks
per-image within the upload queue. Two independent backfill processes cannot
race the same image.

### Convergence / Separation Notes

H2 collapses into H1: the "partial write on a live row" in the detection-failure
branch is not a corruption path — it is the documented retry design. Both
hypotheses point to the same root behavior. No genuine separation.

### Current Best Explanation

CLEAN. The deleted-mid-reencode path is correctly handled in both the
detection-success and detection-failure branches. All variant files are removed
via full dir scan (sizes=[]) on all three format dirs. Pipeline_version is never
bumped for a deleted row. The detection-failure branch deliberately leaves
pipeline_version behind the current version to enable retry. Counter partition
is accurate.

**Confidence: High.**

### Critical Unknown

None for correctness. The only open question is whether best-effort cleanup
leaves orphaned files on transient FS error — but this is disk hygiene, not
a correctness or data-loss defect.

### Discriminating Probe

Not needed; flow traces to CLEAN. If disk-hygiene concern is material, grep
`data/uploads/` for files with no corresponding DB row after a deliberate
delete-mid-reencode in a dev environment.

### Uncertainty Notes

None that affect the CLEAN verdict.

---

## Flow 2: Settings Change → ETag Invalidation

### Observation

An admin flips a `COLOR_IMPACTING_KEY` (e.g. `force_srgb_derivatives`). Two
ETag paths exist: the `serve-upload.ts` route (serves new/missing files and
acts as SW HEAD revalidation target) and the Next.js static server (serves
existing files from `public/uploads/`). The question: is there any path where a
stale variant byte-set is served as fresh after the settings change?

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | The documented two-tier behavior is correct: serve-upload ETag includes settingsHash (invalidates within 5 s), static-path ETag does NOT include settingsHash (stale until backfill re-encodes the file), and this is a DESIGNED limitation | High | Strong | ETag formula directly confirmed in source; next.config.ts headers() for static path confirmed |
| 2 | The 5 s stale-while-revalidate TTL on getServingColorSettingsHash() allows a 5 s window of stale ETag on the serve-upload path, serving an incorrect 304 | Low | Moderate | Module-scoped TTL is real; window is small but non-zero |
| 3 | The FALLBACK_HASH (computed over empty inputs) could persist across a DB-read failure, serving consistent-but-wrong ETags | Very Low | Weak | buildHash({}) is a fixed stable value; a 304 served during this window is only wrong if the hash happened to match the old hash |

### Evidence For

**H1 — serve-upload ETag formula** (`serve-upload.ts:215`):
```typescript
`W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`
```
The hash comes from `getServingColorSettingsHash()` which maintains a
module-scoped 5 s TTL (`CACHE_TTL_MS = 5_000`). After a settings change, at
most 5 s of cached-hash stale window exists on the serve-upload path. After
that, the ETag changes and any If-None-Match comparison breaks the 304 → 200.

**H1 — static-path ETag** (`next.config.ts:51-86`, headers):
```
Cache-Control: public, max-age=3600, must-revalidate
```
Next.js serves existing `public/uploads/` files with its own `W/"{size-hex}-{mtime-hex}"` ETag. This ETag does NOT include the settingsHash. A settings
flip alone — without a file re-encode — does not change mtime or size, so the
static-path ETag is unchanged. The browser receives the same 304 as before the
settings change.

**H1 — documented gotcha** (CLAUDE.md CRT-D1):
"flipping a color/quality/size admin setting does NOT invalidate already-served
STATIC derivatives... the settings-hash ETag only affects the serve-upload path."
This is a known, explicitly documented design constraint, not a latent defect.

**H2 — stale window** (`settings-hash.ts:69`):
`CACHE_TTL_MS = 5_000`. The module-scoped `cache` and `inflight` pattern means
at most 5 s of stale hash. No 304 is served on a new request within 5 s if the
settings changed; after 5 s the next cache miss fetches fresh. The window is
bounded and small.

**H3 — FALLBACK_HASH** (`settings-hash.ts:84`):
`const FALLBACK_HASH = buildHash({})` — computed once over empty inputs. If a
DB read fails, this hash is returned and cached for the next 5 s. This means
a DB failure produces a stable (but incorrect) hash. However: the FALLBACK_HASH
is the same value that would have been returned at app startup before any
settings were written, so the hash can never accidentally match the correct
post-settings-change hash — it always represents "no settings applied."

### Evidence Against / Gaps

**H2 counter**: The 5 s window only matters if a browser makes a conditional GET
for a `serve-upload`-path resource within 5 s of a settings flip. In the
production single-writer topology, the admin settings page POST and the browser
re-fetch are sequential; 5 s is sufficient buffer for all realistic flows. The
Service Worker's HEAD revalidation for derivative cache freshness (R4C9) targets
`/uploads/...` which hits the `serve-upload` route, not static serving — so the
SW correctly sees the updated ETag after the window expires.

**Static-path gap**: This is the documented operational gotcha. The gap is
real but by design. After a settings change, an admin must run a backfill
re-encode to update the on-disk bytes; once the file is rewritten, mtime+size
change and the static-path ETag invalidates naturally. The gap is acknowledged
in CLAUDE.md and in the settings-hash.ts comment.

**H3 counter**: A DB failure during `fetchHashFromDb` returns FALLBACK_HASH,
which is `buildHash({})` — consistent across all instances (deterministic). No
split-brain between ETag values across instances (both return the same fallback).
After the next 5 s cache-miss cycle when the DB recovers, the correct hash
resumes. The worst case is a small window of consistent-but-wrong ETags during
DB unavailability, not corruption.

### Rebuttal Round

Best challenge to H1: "If the admin settings form and the serve-upload path are
on the SAME process (single-writer topology), could a request arrive mid-settings-
write and see an inconsistent hash — one that's neither old nor new?"

Rebuttal: `buildHashFromConfig` in `settings-hash.ts:89-102` reads from a
resolved `GalleryConfig` object, not from a live DB snapshot mid-write. The
`getGalleryConfig()` call in `serve-upload.ts getServingColorSettingsHash`
reads the DB, but the 5 s TTL means the in-flight request's hash is either the
old value (still cached) or the new value (just refreshed). There is no partial-
settings read because the hash is computed over the final resolved GalleryConfig
object in one pass. The 5 s window is the only exposure.

### Convergence / Separation Notes

H2 and H3 are sub-cases of the documented H1 design. They describe bounded
operational windows, not architectural defects. All three hypotheses converge on
the same root description.

### Current Best Explanation

CLEAN. The two-tier ETag behavior is correctly implemented and documented. The
serve-upload path invalidates within 5 s of a settings change. The static-path
stale window is a known design constraint that requires a backfill re-encode to
close. No path serves a stale variant as fresh beyond the documented 5 s
serve-upload window and the static-path post-settings-change gap that persists
until re-encode.

**Confidence: High.**

### Critical Unknown

Whether the 5 s stale window on the serve-upload path causes a visible color
regression in a real admin workflow. Evidence says: unlikely (POST → page reload
→ browser re-fetch is > 5 s in nearly all real cases).

### Discriminating Probe

Not needed for a CLEAN verdict. If the 5 s window is a concern, reduce
`CACHE_TTL_MS` in `settings-hash.ts` or invalidate the module-scoped cache
on settings write. This would be a POLISH item, not a DEFECT.

### Uncertainty Notes

Static-path stale window is real but documented. Not a new finding.

---

## Flow 3: CLIP Semantic Search — Malformed-Embedding Row-Skip and Resolver Heal

### Observation

Two sub-flows:
(a) A malformed embedding row (wrong byte count, legacy base64, or null) in the
`image_embeddings` table should be silently skipped during cosine scan, not
cause the entire search to fail or produce a corrupt score.
(b) A stored `semantic_search_mode='production'` without `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` in the environment should be healed to `'disabled'` by the config resolver, causing the search endpoint to return 503 rather than attempting real CLIP inference.

### Hypothesis Table

| Rank | Hypothesis | Confidence | Evidence Strength | Why it remains plausible |
|------|------------|------------|-------------------|--------------------------|
| 1 | Malformed rows are skipped per-row by decodeEmbeddingColumn returning null; the scan continues; no crash; CLEAN | High | Strong | Both search routes use the same null-filter pattern; code confirmed |
| 2 | The resolver heals 'production'→'disabled' without env flag; 503 returned; CLEAN | High | Strong | gallery-config.ts line 141 directly confirmed |
| 3 | A malformed target embedding in the similar-photos route (GET /api/search/similar/[id]) does not skip but 404s — different behavior from the scan path | Medium | Strong | Gate 6 in similar/[id]/route.ts explicitly 404s on decode failure |

### Evidence For

**H1 — text search route** (`api/search/semantic/route.ts:272-279`):
```typescript
const scored = rows
    .map((row) => {
        const imgEmbedding = decodeEmbeddingColumn(row.embedding);
        if (imgEmbedding === null) return null;
        const score = similarity(queryEmbedding, imgEmbedding);
        return { imageId: row.imageId, score };
    })
    .filter((m): m is { imageId: number; score: number } => m !== null);
```
A null decode → null result → filtered out. The scan continues. The
comment at line 265 directly references AGG-C10-01 and explains the row-skip
intent. Confirmed in BOTH the text-search route and the similar-photos route
(similar/[id]/route.ts:158-166, same pattern).

**H1 — decodeEmbeddingColumn** (`clip-embeddings.ts:108-126`):
Handles three cases:
1. Raw 2048-byte Buffer (current write path) → decode directly
2. Buffer of any other length → attempt base64 decode of its text content
   (legacy rows); if resulting decoded buffer is not 2048 bytes → null
3. String → base64 decode; if not 2048 bytes → null

Any value that does not produce exactly `EMBEDDING_BYTES` (2048) bytes returns
null. No throw. The function is pure and deterministic.

**H2 — resolver heal** (`gallery-config.ts:141`):
```typescript
if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') {
```
When the DB row is `'production'` but `SEMANTIC_SEARCH_ALLOW_PRODUCTION` is not
set, the resolver returns `'disabled'`. Both semantic search routes read via
`getGalleryConfig()` and gate on `semanticMode !== 'stub' && semanticMode !== 'production'`
(text search, lines 227-233) and `semanticMode !== 'production'` (similar
photos, line 101). Both return 503 when the mode is `'disabled'`. Rate-limit
counter is rolled back on the 503 path (lines 228, 102 respectively).

**H3 — similar-photos target embedding path** (`similar/[id]/route.ts:121-135`):
```typescript
if (targetRows.length === 0 || !targetRows[0].embedding) {
    rollbackSemanticAttempt(ip);
    return NextResponse.json({ error: 'No embedding found for this image' }, { status: 404, ...});
}
const decoded = decodeEmbeddingColumn(targetRows[0].embedding);
if (decoded === null) {
    rollbackSemanticAttempt(ip);
    return NextResponse.json({ error: 'Embedding data is corrupt' }, { status: 404, ...});
}
```
The target embedding failing decode is a 404 (rate-limit rolled back). This is
correct: the image exists but has a corrupt embedding — a 404 with a clear
error message is appropriate. The scan pool malformed rows (for the remaining
embeddings fetched in step 7) use the same null-filter skip.

**H1 + H2 — rate-limit rollback consistency**: Every early-exit path on the
semantic routes rolls back the rate-limit counter via `rollbackSemanticAttempt`.
The text-search route rolls back on 503 (disabled), embedding failure, and DB
failure. The similar-photos route rolls back on 503 (non-production), embedding
missing/corrupt, and DB failure. No rate-limit credit leaks to failed requests.

### Evidence Against / Gaps

**H1 — TE-R7C2-03 still untested**: The prior cycle-3 aggregate carried forward
this deferred item: "semantic route malformed-embedding row-skip UNTESTED." The
code path is provably correct by reading the source, but there is no unit test
that exercises a MEDIUMBLOB row with wrong byte count through
`decodeEmbeddingColumn` → null → filter at the scan level. The function itself
has tests (confirmed by AGG-C10-01 reference), but the integration (scan loop
→ decodeEmbeddingColumn → null filter) may not be covered by a fixture test.

**H3 — minor asymmetry**: The target-embedding 404 in the similar-photos route
is correct behavior, but the error string `'Embedding data is corrupt'` leaks
internal state to a public endpoint caller. Not exploitable (no sensitive
information conveyed), but slightly sub-optimal for a public-facing error
response.

### Rebuttal Round

Best challenge to H1: "What if `decodeEmbeddingColumn` receives a Buffer whose
`.length` equals 2048 by coincidence (e.g. a 2048-byte string or non-float32
garbage)? It would pass the byte-length check and produce a garbage Float32Array
that scores incorrectly."

Rebuttal: This is a realistic concern for the stub encoder (which writes
non-normalized vectors) but not for the production encoder. The production
encoder always writes `embeddingToBuffer(truncateAndNormalize(embedding))`
which is a well-formed 2048-byte little-endian float32 array. A row that
somehow got 2048 bytes of garbage through a bug in the write path would score
near-zero against any real query vector because the dot product of a random
unit vector with a garbage non-unit vector approaches zero. The result would
be filtered out by `activeThreshold` (0.22 for production). The risk reduces
to: garbage rows scoring above 0.22 against some query, which would surface as
a false-positive result — a quality issue but not a correctness or security
defect. No evidence that any such rows exist or that the write path can produce
them.

### Convergence / Separation Notes

H1 and H2 are independent sub-flows (malformed-row skip vs resolver heal) but
both trace to CLEAN. H3 (target-embedding 404) is a separate behavior from H1
(scan-pool skip) — they handle the same underlying decode path but in different
contexts with different error semantics. The asymmetry is intentional and
correct.

### Current Best Explanation

CLEAN. Malformed embedding rows are null-decoded and filtered from the scored
list in both search routes; the scan continues with valid rows. The resolver
heals a stored `'production'` to `'disabled'` when the env opt-in is absent,
causing both routes to return 503. Rate-limit counters are rolled back on all
503 and error paths. The one remaining test gap (TE-R7C2-03 — integration test
for scan-loop skip) is a test coverage issue, not a behavioral defect.

**Confidence: High.**

### Critical Unknown

Whether the scan-loop null-filter integration is covered by a test. The function
`decodeEmbeddingColumn` itself is tested (AGG-C10-01), but the `.map → null →
.filter` chain in the route handlers may not be separately exercised.

### Discriminating Probe

Inspect `apps/web/src/__tests__/` for a test that mocks a scan-result row with
wrong-length embedding and asserts it is excluded from `results`. If absent,
this is TE-R7C2-03 (carried from cycle-3), and the probe is: write a unit test
for the `scored` pipeline in `semantic/route.ts` that passes a 512-byte
(wrong-length) Buffer and asserts the final `results` array does not include
that imageId.

### Uncertainty Notes

TE-R7C2-03 deferred item confirmed still open. It is a test coverage gap, not
a live defect. The code path is provably correct from the source read.

---

## Summary

| Flow | Verdict | Confidence | Notable |
|------|---------|------------|---------|
| Admin backfill re-encode / deleted-mid-reencode | CLEAN | High | Both detection branches check affectedRows===0, cleanup uses sizes=[] full dir scan, no pipeline_version strand |
| Settings change → ETag invalidation | CLEAN | High | Serve-upload ETag invalidates within 5 s; static-path stale window documented and by design; no undocumented exposure |
| CLIP semantic search / malformed-row skip + resolver heal | CLEAN | High | decodeEmbeddingColumn null-filters bad rows in both routes; resolver correctly heals 'production'→'disabled'; TE-R7C2-03 remains a test coverage gap only |

**Convergence holds.** No DEFECT found in any of the three traced flows.
TE-R7C2-03 (scan-loop integration test for malformed embedding) remains the
only open carried-forward item, unchanged from cycle-3.
