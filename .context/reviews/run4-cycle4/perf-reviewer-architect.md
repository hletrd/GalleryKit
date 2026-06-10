# Run-4 Cycle 4 — perf-reviewer + architect angle

Inventory: serving hot path (`serve-upload.ts` + the new debounce, both
uploads route twins), `settings-hash.ts` two-form contract, DB pool config
(`db/index.ts` — connectionLimit 10 / queueLimit 20 / connectTimeout 5000),
queue worker (`image-queue.ts` processing + failure + GC), data layer
aggregation posture (`lib/data.ts` tagNamesAgg unchanged — fixture-locked),
semantic scan path (5000-row cap + per-row base64 decode), checkout/webhook
serial awaits, LR route revalidation breadth (known deferral), browser
upload loop shape, smart-collections compile-on-public-page cost (depth-4 /
IN-100 caps), analytics geoip in-process lookup.

## Findings

### PERF-R4C4-01 — serving-path settings-hash debounce blocks every image response on the refresh instead of serving stale (MED / High confidence)
`apps/web/src/lib/serve-upload.ts:42-65` (landed in `e0ce57bb`, R4C3
PERF-R4C3-05). When the 5 s TTL has elapsed, the FIRST request creates
`servingHashInflight` and every request — including the creator — `await`s
it (line 47-48 / 64). Consequences:
1. **Healthy DB**: one image response per 5 s window pays the
   `getGalleryConfig()` round-trip latency inline. Minor, but unnecessary —
   the hash is already known.
2. **Hung DB** (the scenario the docstring explicitly claims to cover: "a
   misbehaving DB cannot stall image responses"): `getGalleryConfig()` hangs
   up to the pool's 5 s connectTimeout (or queueLimit-induced wait). Once
   the TTL expires there is essentially ALWAYS an unresolved inflight, and
   EVERY derivative GET/HEAD/304 joins it — the whole image surface stalls
   in lockstep until each attempt fails, then re-stalls on the next attempt.
   The fallback ("serve the last known hash") only engages AFTER each
   failure resolves; it never prevents the stall.
The docstring's resilience claim is therefore false in the exact failure
mode it names. Not a regression (the pre-R4C3 per-request form had the same
blocking), but the fix's own contract is unmet.
Fix: stale-while-revalidate — when `servingHashCache` exists (fresh OR
stale), return its hash immediately; kick the refresh off in the background
(unawaited, error-swallowed into the existing catch semantics). Only block
when NO hash has ever been resolved (true cold start). Update
`serve-upload-settings-debounce.test.ts`: the TTL-elapse test asserts a
refetch is TRIGGERED (call count), and a new case asserts the stale-window
response does not await the slow refresh (resolve-order assertion). ETag
skew remains within the documented ≤5 s + one refresh latency.

### ARCH concur on COR-R4C4-03 (LR route containment)
The browser/LR ingest parity gap class has now produced findings in run-3
cycles 1-4 and run-4 cycles 1-4. The structural fix (shared ingest helper)
was evaluated and REJECTED again this cycle for the same reason as
ARCH-R4C3-06: the two paths' divergences are intentional (form-data vs
action args, JSON-vs-localized errors, single- vs multi-file) and a forced
abstraction would hide them; the cheap containment widening + tests is the
right-sized fix. Recorded so future cycles stop re-litigating.

### Verified-clean / no-action notes
- The serving debounce module-scoped cache is correct for the single-writer
  topology (CLAUDE.md) — no cross-process invalidation needed beyond the
  documented 5 s skew.
- `image_sizes`/quality keys are in the hash → ETag invalidation breadth is
  right; no missing color-impacting key found (cross-checked
  `COLOR_IMPACTING_KEYS` against `gallery-config-shared` validation set).
- Semantic route: 5000×512-float decode per request is bounded by the 30/min
  rate limit and `semanticSearchMode==='production'` gate (stub today) — no
  action until real inference ships (existing US-P51 scope).
- Queue: fire-and-forget caption/embedding hooks cannot block the worker;
  conditional UPDATE + advisory claim release in finally — sound.
- No N+1 found on the masonry list paths; `tagNamesAgg` contract intact.
- Pool: `poolConnection.query/execute` wrappers acquire/release per call —
  correct; keepalive on.
- LR `revalidateAllAppData()` breadth: remains DEF-R4C1-01 (deferred,
  exit criterion: ISR reintroduction) — unchanged, not re-flagged.
