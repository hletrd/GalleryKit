# Perf-Reviewer Review — Run-3 Cycle 1 (HEAD 2508f132)

Date: 2026-06-04
Method: direct orchestrator review (Task fan-out unavailable; see
test-engineer.md preamble).

## Findings

No net-new performance findings (CRIT/HIGH/MED/LOW = 0).

## Re-verified clean

- **serve-upload.ts:** HEAD short-circuit avoids stream allocation + fd open for
  crawler bursts; If-None-Match 304 avoids body transfer; `must-revalidate` +
  1h max-age balances freshness vs DB load. `getGalleryConfig()` +
  `getColorSettingsHash()` per request is the one cost on the hot image path,
  but both are cheap and the config read is React-cached; acceptable. No change.
- **image-queue.ts:** single-job default concurrency with libvips fan-out per
  job; bootstrap batched at 500 with cursor pagination + `onIdle` continuation
  so a large pending backlog doesn't block; retry/claim maps FIFO-pruned at 10k
  cap; gc interval `unref`'d. Sound.
- **admin-backfill-runner.ts:** dedicated PQueue (default concurrency 1) so the
  in-app backfill shares Sharp capacity gracefully with the live queue;
  candidates streamed by `pipeline_version < CURRENT` so completed rows filter
  out. Sound.
- **sitemap.ts:** ISR `revalidate = 3600` (force-dynamic correctly dropped per
  AGG8F-02) protects the DB from crawler bursts; URL budget math caps at 50k.
- **Data layer:** `tagNamesAgg` shared GROUP_CONCAT constant; React `cache()`
  dedup on `getImage`/`getTopicBySlug`; `Promise.all` parallelizes independent
  queries. Composite indexes match listing sort orders. No N+1 surfaced.

Note: the `serve-upload` test flakiness (test-engineer F1) is a test-discovery
issue, not a runtime perf issue.
