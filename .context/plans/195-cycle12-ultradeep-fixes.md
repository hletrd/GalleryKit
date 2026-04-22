# Plan 195 — Cycle 12 Ultradeep Fixes

**Source review:** Cycle 12 Aggregate Review (`C12-01` through `C12-04`)
**Status:** DONE
**User-injected TODOs honored this cycle:** `deeper`, `ultradeep comprehensive`, `find yourself and make sure to not ask again`, `go on`

## Findings to Address This Cycle

| ID | Description | Severity | Confidence |
|---|---|---|---|
| C12-01 | Unicode tag slugs are accepted on writes but rejected by public filtering/load-more paths | HIGH | HIGH |
| C12-02 | EXIF datetime parsing/formatting accepts impossible calendar dates | MEDIUM | HIGH |
| C12-03 | Docker health check still uses DB readiness as process liveness | HIGH | HIGH |
| C12-04 | Same-origin request validation rejects default-port hosts (`:80` / `:443`) | MEDIUM | HIGH |

## Implementation Plan

1. **Unify tag-slug validation across write and read paths**
   - Extract/reuse the same Unicode-safe tag-slug validator in public filtering/data helpers.
   - Update `loadMoreImages()` and the shared data-layer tag filter to accept the same slug contract as tag creation/update.
   - Add regression coverage so a Unicode tag slug remains active through topic filters and load-more requests.

2. **Reject impossible EXIF calendar values consistently**
   - Introduce a shared date-part validator that round-trips UTC year/month/day/hour/minute/second.
   - Use it in both upload-side EXIF parsing and display-side stored EXIF formatting.
   - Add regression tests for valid leap-day input and invalid calendar combinations.

3. **Split liveness from readiness for container health**
   - Add a process-only liveness route for the Docker `HEALTHCHECK`.
   - Keep the DB-aware readiness signal on `/api/health` for diagnostics/monitoring.
   - Add route coverage and update Docker comments/docs so operators understand the contract.

4. **Normalize same-origin checks for default ports**
   - Canonicalize the expected origin via `URL.origin` so `Host: example.com:443` matches browser `Origin: https://example.com`.
   - Add regression coverage for default-port HTTPS/HTTP cases and keep current positive/negative tests passing.

## Verification Goals

- `npm run lint --workspace=apps/web`
- `npm run build`
- `npm test --workspace=apps/web`
- `npm run test:e2e --workspace=apps/web`
- Per-cycle deploy command succeeds after green gates:
  - `ssh -i ~/.ssh/atik.pem ubuntu@gallery.atik.kr "cd /home/ubuntu/gallery && bash apps/web/deploy.sh"`

## Completion Notes

- [x] `C12-01` fixed by reusing the Unicode-safe tag-slug validator in `loadMoreImages()` and the shared data-layer tag filter.
- [x] `C12-02` fixed by round-trip-validating EXIF date/time parts in both upload-side parsing and display-side formatting.
- [x] `C12-03` fixed by introducing `/api/live` for process liveness and pointing Docker `HEALTHCHECK` at it while preserving DB-aware `/api/health`.
- [x] `C12-04` fixed by canonicalizing the expected origin via `URL.origin`, so default-port hosts match browser `Origin`/`Referer` behavior.

## Verification Results

- [x] `npm run lint --workspace=apps/web`
- [x] `npm run build`
- [x] `npm test --workspace=apps/web`
- [x] `npm run test:e2e --workspace=apps/web`
