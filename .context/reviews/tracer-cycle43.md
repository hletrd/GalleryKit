# Tracer — Cycle 43 (2026-04-20)

## Causal Traces

### Trace 1: Upload → DB → Queue → Process → Serve (happy path)
1. User uploads file via `uploadImages` (images.ts)
2. File streamed to `public/uploads/original/` with UUID filename
3. EXIF extracted, GPS stripped if config says so
4. DB insert with `processed: false`
5. Tag processing with `stripControlChars` applied
6. `enqueueImageProcessing` adds to PQueue
7. Queue job acquires advisory lock, processes formats via Sharp
8. Conditional UPDATE sets `processed: true`
9. Served via `serveUploadFile` with path traversal protection

**No issues found.** The flow is well-protected with proper sanitization, UUID filenames, path validation, and conditional updates.

### Trace 2: mysqldump child process env inheritance
1. `dumpDatabase` spawns `mysqldump` with explicit env
2. `HOME` is NOT passed (removed in commit 00000002b)
3. `LANG`/`LC_ALL` ARE passed from process.env
4. If server locale changes between dumps, output encoding could differ
5. Restore might fail if locale affects character set handling

**Finding:** LANG/LC_ALL should be set to `C.UTF-8` for deterministic behavior. Same as C43-01.

### Trace 3: CSV export → user download
1. `exportImagesCsv` queries up to 50K rows with GROUP_CONCAT
2. `escapeCsvField` strips `\r\n`, handles formula injection
3. Data in DB may contain control chars from before sanitization was added
4. `escapeCsvField` does NOT strip null bytes or other control characters
5. CSV parsers may misinterpret null bytes

**Finding:** `escapeCsvField` should defensively strip control characters. Same as CR43-02/S43-04.

### Trace 4: Rate limit pre-increment → check → rollback pattern
Traced through login, password change, user creation, share creation, and search rate limiting. All follow the same pattern:
1. Pre-increment in-memory Map
2. Pre-increment DB counter
3. Check DB limit
4. If limited: roll back in-memory counter
5. On success: roll back/reset counters
6. On error: roll back counters

**No issues found.** The pattern is consistently implemented across all rate-limited actions.

## Summary
1 MEDIUM finding (LANG/LC/LC_ALL passthrough — confirmed by multiple agents), 1 LOW finding (CSV control character handling). All major data flows are correctly protected.
