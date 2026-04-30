# Performance Review — perf-reviewer — Cycle 2 Fresh

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-29

## Summary

- No new critical or high performance findings beyond those already captured in prior cycle deferred items (AGG1-14 through AGG1-20).
- One new medium finding.

## New Finding

### C2-PERF-01 (Medium / Medium). `deleteImages` sequential file cleanup

- Location: `apps/web/src/app/actions/images.ts:618-636`
- Same as C2-CR-01 / C2-CRIT-01. The for-of loop serializes per-image cleanup. Each image triggers up to 4 filesystem operations (original delete + 3 directory scans for variant cleanup when `sizes=[]`). For a 50-image batch, this is ~200 sequential I/O ops.
- The inner `collectImageCleanupFailures` runs 4 ops in parallel per image, which is good. But the outer loop should allow a small concurrency (3-5 images at a time) to reduce wall-clock time.
- Impact: on local SSD, ~1-2s for 50 images. On NAS, could be 5-10s. The server action response is blocked throughout.

## Deferred items confirmed still valid

- AGG1-14 (First public listing page forces grouped count/window work): still deferred, still valid.
- AGG1-15 (Tag count/list data recomputed per dynamic request): still deferred, still valid.
- AGG1-16 (Public search uses leading-wildcard LIKE scans): still deferred, still valid.
- AGG1-17 (Upload action holds advisory lock through slow work): still deferred, still valid.
- AGG1-19 (Bulk delete can perform hundreds of directory scans): partially addressed by C2-PERF-01 finding (sequential loop), but the directory-scan-per-image concern is the same as prior deferred item.
