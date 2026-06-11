# Run-4 Cycle 13 — perf-reviewer / architect angle

Full-inventory in-context pass (single-subagent constraint documented in the
aggregate). Inventory: topics action lock topology (`withTopicRouteMutationLock`
hold windows vs. Sharp work), `process-topic-image.ts` pipeline cost,
`image-url.ts` srcset fan-out, `getMapImages` query shape, the cycle-12 fix's
pool-connection accounting, and the recreate-pattern uniqueness sweep.

## Cycle-12 fix — pool accounting re-verified

Post-fix, a restore that begins mid-processing holds its two dedicated
connections (`LOCK_DB_RESTORE`, upload-contract) only for the bounded
duration of one in-flight job + the import itself; the 2-of-10 leak mode is
gone. No new perf concerns.

## Architecture finding (joint with code angle)

- **COR-R4C13-01 architecture view** — the topics PK-rename-by-recreate is
  the codebase's ONLY recreate-row idiom (sweep confirmed). Its column-list
  is a hidden coupling point with `db/schema.ts`: schema growth must be
  mirrored manually. Two structural mitigations considered:
  1. Thread the authoritative row from the in-transaction SELECT (chosen —
     minimal, also closes the pre-lock image_filename TOCTOU);
  2. Switch to `UPDATE topics SET slug = ?` and rely on FK `ON UPDATE
     CASCADE` — rejected: the schema declares no ON UPDATE actions, images/
     aliases FKs would need migration, and MySQL FK cascade on PK update
     has its own gotchas with Drizzle's migration story. Not worth it for
     one admin-rare operation.
  The VALUES-pinning test makes the remaining manual mirror fail loudly.

## Perf notes (no scheduled findings)

- `updateTopic`/`createTopic` run `processTopicImage` (Sharp encode, up to
  hundreds of ms) BEFORE acquiring `LOCK_TOPIC_ROUTE_SEGMENTS` — lock hold
  time stays short (route-existence SELECT + small writes). Good as-is.
- `createTopic` performs `deleteTopicImage` (one unlink) inside the lock on
  the route-conflict path — negligible I/O under a 5 s lock timeout; not
  worth restructuring.
- `topicRouteSegmentExists` is a single UNION ALL round-trip with LIMIT 1 —
  already optimized (C3L-CR-02).
- `getMapImages` INNER JOIN on `topics.map_visible` — bounded by the
  map-visible subset; no pagination concern at personal-gallery scale; the
  runtime per-row assert is O(n) over returned rows only.
- `sizedImageSrcSet` allocates one string per configured size (≤ 8) per
  image per render — trivial; list pages memoize at the component layer.
- `process-topic-image.ts` streams the upload to a temp file before Sharp
  (no whole-file Buffer in memory) and emits a single 512×512 webp — no
  rgb16 fan-out, no concurrency interaction with the image queue. Clean.

## No-finding sweeps

- No new unbounded Maps/Sets introduced since c12 (the blur-data-url
  rejection log remains LRU-capped at 256).
- No `await` inside hot per-row loops on the rotation surfaces.
- No N+1 query introduced by the planned fix (it reuses the existing
  in-transaction SELECT, widening its column list only).
