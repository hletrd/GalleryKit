# Code-Reviewer Review — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator review (Task fan-out unavailable; see
test-engineer.md preamble).

## F2 — Lightroom PAT upload path bypasses the `allow_hdr_ingest` ingest gate — MEDIUM, High confidence

**Files:**
- `apps/web/src/app/actions/images.ts:294-301` (browser path — HAS the gate)
- `apps/web/src/app/api/admin/lr/upload/route.ts:120-149` (LR path — LACKS the gate)

**Evidence:** The browser upload action rejects HDR sources by default:

```ts
// images.ts:295
if (data.colorSignals?.isHdr && !uploadConfig.allowHdrIngest) {
    await deleteOriginalUploadFile(savedOriginalFilename);
    failedFiles.push(file.name);
    hdrRejectedCount++;
    continue;
}
```

The Lightroom PAT route at `/api/admin/lr/upload` performs **no such check**.
It reads `config = await getGalleryConfig()` (line 104) but only consumes
`config.stripGpsOnUpload`, `config.imageQuality*`, and `config.imageSizes`. It
never reads `config.allowHdrIngest`. It unconditionally inserts
`is_hdr: data.colorSignals?.isHdr ?? false` and
`transfer_function: data.colorSignals?.transferFunction ?? null` (lines 143-144)
and enqueues processing.

**Why it's a problem:** `allow_hdr_ingest` (default `false`) is documented in
CLAUDE.md as: "PQ / HLG sources are **rejected at upload** by default." A
photographer who deliberately keeps the default-off setting expects PQ/HLG HEICs
to be rejected. Via the Lightroom Classic publish plugin — the *primary*
non-browser ingest path — they are silently accepted instead. This is an
admin-intent / contract drift, and it is **exactly** the drift the R8 plan
warned about:

> `.context/plans/photographer-r8/plan-critical-high.md:56` — "Extract shared
> 'build image insert values' helper from `images.ts` to prevent future drift
> between browser and Lightroom upload paths."

R8-H2 closed the color-*signal-storage* half of the LR/browser parity gap but
did not port the HDR ingest *gate*. The gate never made it across.

**Severity rationale (MEDIUM, not HIGH/CRIT):** This is NOT a public-honesty
violation. `process-image.ts` does not reject HDR; it encodes every source as
SDR derivatives, and `is_hdr` / `transfer_function` are admin-only fields
(verified against `_PrivacySensitiveKeys`), so the public never sees an HDR
badge whose bytes don't fulfill it (CLAUDE.md honesty rule held). The harm is
limited to: (a) admin's explicit default-off setting being ignored on one path,
and (b) an HDR original landing on disk + DB that the admin asked to reject.

**Fix:** In `/api/admin/lr/upload/route.ts`, after `saveOriginalAndGetMetadata`
and before the DB insert, mirror the browser gate:

```ts
if (data.colorSignals?.isHdr && !config.allowHdrIngest) {
    await deleteOriginalUploadFile(data.filenameOriginal);
    return NextResponse.json(
        { error: 'HDR ingest is disabled' },
        { status: 422, headers: NO_CACHE },
    );
}
```

(Use the existing `deleteOriginalUploadFile` from `@/lib/...` already used by
the browser path; `config` is already in scope at line 104.)

## Re-verified clean (no new findings)

- `serve-upload.ts`: ETag composition `W/"v${VERSION}-${mtimeMs}-${size}-${hash}"`,
  HEAD short-circuit, If-None-Match `*`/list parsing, realpath TOCTOU close —
  all correct.
- `image-queue.ts`: claim/release lock lifecycle in `finally`, retry/permanent-
  failure bookkeeping, bootstrap cursor + `notInArray` permanently-failed
  exclusion, FIFO map pruning — internally consistent.
- `admin-backfill-runner.ts`: R29-CRIT-1 all-inside-try/finally lock+state
  release intact; detection-failure branch does not bump pipeline_version
  (resume invariant preserved).
- `admin-tokens.ts`: constant-time hash compare, fail-closed on missing table,
  scope allowlist + dedup. Clean.
- `stripe/webhook/route.ts`, `download/[imageId]/route.ts`: idempotency,
  single-use atomic claim, file-check-before-claim ordering, RFC-6266/5987
  Content-Disposition — clean.
- `sitemap.ts`, `smart-collections.ts`: ISR revalidate, allowlist + parameter
  binding — clean.
