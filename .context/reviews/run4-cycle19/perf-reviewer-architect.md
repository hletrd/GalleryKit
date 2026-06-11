# Run-4 Cycle 19 — perf-reviewer + architect angle

## Architectural root cause behind COR-R4C19-01 / COR-R4C19-03

The codebase has **no canonical seam for raw-SQL row extraction**: the
tuple-unwrap idiom (`Array.isArray(result) ? result[0] : result`) is
hand-copied in 7 sites across admin-tokens.ts, admin-backfill-runner.ts
and backfill-color-pipeline.ts, while two other sites (topics.ts:48,
backfill-cicp-recheck.ts:62) never received it. The C3L-CR-02 perf
"optimization" (two typed `db.select`s → one raw UNION `db.execute`)
silently crossed from the typed query-builder world (rows arrays) into
the raw-driver world (tuples) — a layering boundary with a shape change
that nothing enforces.

**Recommendation (architect):** fix the two broken sites with the
documented inline idiom this cycle (minimal diff on audited surfaces);
record a follow-up that the NEXT raw `db.execute` consumer added should
introduce a typed `extractRows<T>()` helper and migrate call sites
opportunistically. Migrating all 9 sites in one cycle churns audited
payment/token code for zero behavior change — deferred with that exit
criterion (DEF-R4C19-B).

Also worth noting: the original two `db.select` queries were each
index-backed primary-key lookups; the UNION ALL + LIMIT 1 raw query
saves one round-trip on a path executed only on admin topic mutations
(rare). The perf win was negligible relative to the type-safety loss —
a useful calibration note for future "combine queries" findings; the
typed `unionAll` builder from `drizzle-orm/mysql-core` would have kept
rows-array semantics. Either fix shape is acceptable; the inline unwrap
is the smaller diff.

## Perf review of the rotation surfaces

- **backfill-alt-text / backfill-clip-embeddings offset pagination**
  (COR-R4C19-04, shared with code angle): besides skipping rows, the
  `LIMIT … OFFSET n` shape forces MySQL to walk and discard `n` rows
  per batch — O(N²/batch) scans on large tables. Keyset pagination
  (`id > cursor`) fixes correctness AND makes each batch an index
  range seek. One fix, two wins.
- `backfill-cicp-recheck` PQueue concurrency (default 2,
  `BACKFILL_CONCURRENCY` env) and `queue.onEmpty()` join are fine
  once the row-shape bug is fixed; task-rejection propagation is the
  debugger angle's concern.
- `seed-e2e.ts` createVariants: serial per-size loop with
  `Promise.all` inside per format — bounded (4 sizes × 2 images),
  fine for a test seed.
- `entrypoint.sh` `chown -R` on `/app/data` only when top-level owner
  differs — avoids the slow recursive chown on warm restarts; the
  partial-chown edge (interrupted first boot leaves nested root files
  with a node-owned top) is theoretical and self-heals on the next
  ownership flip; INFO.
- `check-api-auth.ts` / `check-public-route-rate-limit.ts`: full TS
  AST parse per route file at lint time — trivial corpus size, fine.
- `build-sw.ts` execFileSync git call: one-shot prebuild, fine.
- `upload-tracker-state.ts`: collect-then-delete prune with hard cap
  2000 — bounded; insertion-order eviction is the documented
  BoundedMap convention.

## No-finding confirmations

- No N+1 in seed-e2e (two images); tag upsert loop bounded at 3.
- `run-e2e-server.mjs` builds with `BASE_URL` injection then swaps
  static dir — required by standalone output, no redundant rebuild.
- PWA icon generation: 3 sharp rasterizations at prebuild — fine.
