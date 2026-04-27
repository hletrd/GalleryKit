# Tracer — Cycle 3 Deep Review (2026-04-27)

**HEAD:** `9958152 docs(reviews): record cycle-2 fresh review findings and plan`

## Causal Traces

### Trace 1: Upload → Process → Serve (Full Pipeline)

```
uploadImages() [images.ts:116]
  → saveOriginalAndGetMetadata() [process-image.ts:227]
    → ensureDirs() singleton
    → getSafeExtension() — strips non-alphanumeric
    → randomUUID() for filename
    → pipeline(nodeStream, createWriteStream) with mode 0o600
    → sharp(originalPath) with limitInputPixels
    → exifReader(metadata.exif) — bounds-checked ICC parsing
    → assertBlurDataUrl() on producer output [blur-data-url.ts:104]
  → extractExifForDb() [process-image.ts:508]
    → parseExifDateTime() — validates range (1900-2100)
    → convertDMSToDD() — bounds-checked GPS conversion
  → db.insert(images) [images.ts:316]
  → enqueueImageProcessing() [image-queue.ts:189]
    → PQueue.add() → acquireImageProcessingClaim() → GET_LOCK
    → processImageFormats() [process-image.ts:383]
      → Promise.all(webp, avif, jpeg) — parallel format generation
      → Atomic rename via .tmp for base filename
      → Post-verification: stat all 3 base files non-zero
    → db.update(images).set({ processed: true }) WHERE processed = false
    → releaseImageProcessingClaim()
serveUploadFile() [serve-upload.ts:32]
  → SAFE_SEGMENT regex + ALLOWED_UPLOAD_DIRS whitelist
  → lstat() rejects symlinks
  → realpath() + startsWith() containment check
  → DIR_EXTENSION_MAP enforces extension-directory match
```

**Verdict:** Pipeline is secure end-to-end. All defense-in-depth layers are in place.

### Trace 2: Login → Session → Admin Action

```
login() [auth.ts:70]
  → stripControlChars(username + password)
  → hasTrustedSameOrigin() — Origin/Referer + Host reconciliation
  → pruneLoginRateLimit() — evict expired + cap overflow
  → Pre-increment rate limit (in-memory + DB)
  → checkRateLimit() — DB-backed count
  → argon2.verify(hashToCheck, password) — timing-safe with dummy hash
  → db.transaction() — insert session + delete pre-existing sessions
  → cookieStore.set() — httpOnly, secure, sameSite: lax
  → redirect()

Admin action (e.g., updateImageMetadata):
  → isAdmin() → getCurrentUser() → cache(verifySessionToken)
  → requireSameOriginAdmin() → hasTrustedSameOrigin()
  → stripControlChars(title, description)
  → containsUnicodeFormatting() check
  → db.update(images) — Drizzle parameterized
  → revalidateLocalizedPaths()
```

**Verdict:** Auth flow is complete and well-guarded. Rate limiting covers both per-IP and per-account dimensions.

### Trace 3: DB Restore Flow

```
restoreDatabase() [db-actions.ts:249]
  → isAdmin() + requireSameOriginAdmin()
  → GET_LOCK('gallerykit_db_restore', 0) — advisory lock
  → beginRestoreMaintenance() — in-memory flag
  → flushBufferedSharedGroupViewCounts() — drain view counts
  → quiesceImageProcessingQueueForRestore() — pause + clear queue
  → runRestore()
    → File size check (250MB cap)
    → Stream to tempPath with mode 0o600
    → hasPlausibleSqlDumpHeader() — validate header
    → Chunked SQL scan: appendSqlScanChunk() + containsDangerousSql()
    → spawn('mysql', ['--one-database', ...]) with env vars (no CLI creds)
    → readStream.pipe(restore.stdin)
    → On success: revalidateAllAppData()
  → finally: endRestoreMaintenance(), resume queue, RELEASE_LOCK
```

**Verdict:** Restore flow is well-guarded. Advisory lock prevents concurrent restores. SQL scanner provides defense-in-depth. Queue is properly paused and resumed.

## Findings (New)

No new causal trace issues found. All critical flows traced successfully with expected behavior at each step.
