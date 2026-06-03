# Code review — Run-3 Cycle 3

## CR-C3-01 (LOW / Med) — PAT path does not acquire the upload-processing-contract lock

**Citation:** `apps/web/src/app/api/admin/lr/upload/route.ts` (no
`acquireUploadProcessingContractLock` call). Browser parity:
`apps/web/src/app/actions/images.ts:183`. Settings side:
`apps/web/src/app/actions/settings.ts:75-110` ("lock once photos exist" —
returns `imageSizesLocked` when the lock is held).

**Problem:** The MySQL advisory lock `gallerykit_upload_processing_contract`
serializes uploads against `image_sizes` / `strip_gps_on_upload` settings
changes so "the first committed image cannot race a setting that is intended to
lock once photos exist" (CLAUDE.md, Race Condition Protections). The browser
upload acquires it for the whole upload window; the LR PAT path does not. An LR
publish can therefore commit the first image concurrently with an admin
flipping `image_sizes`, defeating the lock-once guarantee on the PAT path.

**Failure scenario:** Fresh gallery, zero photos. Admin opens settings to change
`image_sizes` while a queued LR publish lands its first image. The settings
change and the LR upload interleave; the "locked once photos exist" invariant is
violated for that first image.

**Severity rationale:** LOW on the shipped single-writer topology (CLAUDE.md
Runtime topology) — the window is narrow and the PAT is a trusted admin scope.
Recommend mirroring the lock acquisition for parity (cheap, `try/finally`
release) rather than deferring, since it is a correctness invariant the repo
explicitly documents.

## CR-C3-02 (LOW / High) — PAT path collapses RawFileError into a generic 422

**Citation:** `route.ts` catch block around `saveOriginalAndGetMetadata`
returns `{ error: msg }` / "Upload failed" for ALL throws. Browser parity:
`images.ts:478,506` catches `RawFileError` separately → `rawNotSupported`.

**Problem:** A RAW dropped through the LR plugin (e.g. a `.dng` sidecar) is
correctly *rejected* (the shared `getSafeExtension` throws), but the client
receives an opaque "Upload failed" instead of the actionable "RAW not supported
— export to JPEG/TIFF/AVIF first." Correctness is preserved; only the error
message diverges. The LR plugin almost always sends rendered JPEGs, so impact is
low, but mirroring the specific message is a one-line `instanceof RawFileError`
check.

**Fix:** in the catch, `if (err instanceof RawFileError) return 422 with a
"RAW not supported" message`. Import `RawFileError` (already exported from
`process-image.ts`).
