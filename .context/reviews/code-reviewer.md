# Code Reviewer — Cycle 7 Ultradeep Review

## Review Scope & Inventory

I built a repo-wide review-relevant inventory from `git ls-files` before reviewing and covered the whole repository with emphasis on `apps/web` runtime code, configs, scripts, and tests.

### Inventory Summary
- Repo docs/meta/config: 43 tracked files
- `apps/web` config/build/deploy files: 13
- `apps/web/src/app`: 54
- `apps/web/src/components`: 44
- `apps/web/src/lib`: 40
- `apps/web/src/db` + i18n/misc runtime files: 7
- Tests (`src/__tests__` + `e2e`): 24
- Scripts + SQL migrations: 18

### Verification Performed
- `npm test --workspace=apps/web` ✅ (17 files / 115 tests passed)
- `npm run lint --workspace=apps/web` ✅
- `npx tsc -p apps/web/tsconfig.json --noEmit` ✅
- `npx tsc -p apps/web/tsconfig.scripts.json --noEmit` ✅
- `npm run build --workspace=apps/web` ✅
- Final missed-issues sweep: grep review for child-process usage, SQL restore scanning, JSON-LD emission, thumbnail paths, dangerous HTML sinks, TODO/FIXME markers, and route/config edge cases.

## Confirmed Issues

### 1) SQL restore safety scan can still be bypassed across chunk boundaries
**Severity:** MEDIUM  
**Confidence:** High  
**Citations:**
- `apps/web/src/app/[locale]/admin/db-actions.ts:327-340`
- `apps/web/src/lib/sql-restore-scan.ts:1-30, 58-60`

**Why this is a problem**
The restore path scans the uploaded dump in 1 MiB chunks with only a forward 1 KiB overlap. That catches short boundary splits, but it does **not** guarantee detection when a dangerous statement spans the boundary with more than 1 KiB of whitespace/comment padding between tokens. The regex layer in `containsDangerousSql()` still expects the full dangerous statement to exist in a single scanned string.

**Concrete failure scenario**
An operator uploads a crafted dump containing a statement like `DROP` + 1500 spaces/newlines + `DATABASE foo;` positioned so `DROP` lands near the end of one chunk and `DATABASE` begins after the 1 KiB forward overlap window. The scan misses it, but the `mysql` process still executes the statement during restore.

**Suggested fix**
Scan with a sliding carry-over buffer that preserves the **tail of the previous chunk** (not just extra bytes after the current offset), and size that carry-over to cover the longest dangerous pattern including arbitrary whitespace/comments. A safer alternative is statement-aware tokenization/parsing before handing the dump to `mysql`.

---

### 2) The photo viewer labels a processed JPEG download as the “original” file
**Severity:** MEDIUM  
**Confidence:** High  
**Citations:**
- `apps/web/src/components/photo-viewer.tsx:95-97`
- `apps/web/src/components/photo-viewer.tsx:528-536`

**Why this is a problem**
The download link always points at `/uploads/jpeg/${image.filename_jpeg}`, which is the generated JPEG derivative, while the UI text says `downloadOriginal`. Those are not the same asset: uploads can start as HEIC/AVIF/TIFF/RAW-like formats, and the original private file is stored separately from the public JPEG derivative.

**Concrete failure scenario**
An admin uploads a HEIC with richer EXIF/color data, then later clicks “Download original” from the viewer to archive or re-edit it. They receive the processed JPEG instead of the source asset, losing format fidelity and potentially metadata they expected to preserve.

**Suggested fix**
Either (a) relabel the action to something accurate like “Download JPEG” / “Download processed image”, or (b) add a real authenticated original-download path for admins that serves `filename_original` from the private originals directory.

---

### 3) Public search thumbnails and admin image-manager previews fetch the full base JPEG instead of a small derivative
**Severity:** MEDIUM  
**Confidence:** High  
**Citations:**
- `apps/web/src/components/search.tsx:208-215`
- `apps/web/src/components/image-manager.tsx:342-349`

**Why this is a problem**
Both surfaces render tiny thumbnails (48px and 128px), but they point at `/uploads/jpeg/${filename_jpeg}` — the base JPEG alias that maps to the largest configured derivative. That defeats the configured multi-size pipeline and turns small preview grids into large image downloads.

**Concrete failure scenario**
Open the search dialog after uploading several high-resolution photos. Each 48×48 result thumbnail can trigger download of a multi-megabyte JPEG instead of a 640px derivative, causing visible latency/jank on slower devices and multiplying origin/CDN bandwidth for a UI that should be cheap.

**Suggested fix**
Use the nearest configured small derivative (for example via `findNearestImageSize(imageSizes, 640)` or a dedicated thumbnail helper) in both search and admin preview surfaces, just like the gallery/lightbox pages already do.

---

### 4) Photo JSON-LD hardcodes a CC BY-NC 4.0 license for every image regardless of site/operator intent
**Severity:** MEDIUM  
**Confidence:** High  
**Citations:**
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:142-149`

**Why this is a problem**
The structured data always emits:
- `license: 'https://creativecommons.org/licenses/by-nc/4.0/'`
- `acquireLicensePage: siteConfig.parent_url`

There is no matching admin setting or per-image license source. That means the app is publishing rights metadata it cannot verify.

**Concrete failure scenario**
A customer hosts copyrighted client work or private family photos with no CC grant. Search engines and downstream consumers ingest the page’s JSON-LD and treat the image as CC BY-NC 4.0 licensed, creating compliance/legal confusion that the operator never intended.

**Suggested fix**
Do not emit `license` / `acquireLicensePage` unless those values come from explicit configuration. If licensing is optional, gate these JSON-LD fields behind a real site setting and default to omitting them.

## Likely Issues
- None strong enough to elevate beyond the confirmed list above.

## Risks Requiring Manual Validation

### R1) Production deployments without `TRUST_PROXY=true` collapse all rate limiting to the shared `"unknown"` bucket
**Severity:** MEDIUM  
**Confidence:** Medium  
**Citations:**
- `apps/web/src/lib/rate-limit.ts:59-81`

**Why this is a risk**
If the app runs behind a reverse proxy and `TRUST_PROXY` is not set, every login/search/share/upload limiter falls back to the literal key `unknown`. The code logs a warning once, but keeps serving traffic.

**Concrete failure scenario**
A reverse-proxied production deployment forgets `TRUST_PROXY=true`. One noisy user (or bot) exhausts the shared search/login budget, and unrelated users start hitting rate limits because they all resolve to the same bucket.

**Suggested fix**
Fail fast in production when proxy headers are present but `TRUST_PROXY` is unset, or derive a safe direct client address when available instead of collapsing everything to a shared sentinel value.

## Recommendation
**REQUEST CHANGES**

The repo is in good operational shape (tests/lint/typecheck/build all pass), but the current code still has review-blocking medium-severity correctness/safety issues in the SQL restore guardrail, user-facing download semantics, thumbnail delivery path, and structured-data licensing output.
