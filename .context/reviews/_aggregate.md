# Latest Aggregate Review

Current aggregate: `cycle-2-2026-07-07/_aggregate.md` (run-10 cycle 2/100, reviewed HEAD `642c5091`;
the mandatory carry-over Docker build fix landed mid-review as `223b3836`).

Run-10 cycle 2 was a full 12-lane fresh fan-out (11 file-writing lanes + the secondary
feature-dev code-reviewer message lane). It produced 55 deduplicated findings (C2-01..C2-55).
The first fan-out attempt this cycle was wiped by an API session limit before any lane wrote
output and was fully re-spawned.

Highest-signal items:

- Carry-over (closed): deploy-host container build failed on workspace-nested `drizzle-kit`
  (TS2307 in `drizzle.config.ts`); root-caused to the builder stage copying only root
  `/app/node_modules`, fixed + negative-control verified in `223b3836`.
- `C2-01` — focus lost to `<body>` after closing Lightbox / mobile Info sheet (live-reproduced).
- `C2-02` — 7 of 9 byte-impacting admin settings accepted silently with no re-encode prompt/marker.
- `C2-03` — single-writer topology has no code-level guard (3-lane agreement).
- `C2-04` — soft 404: all public not-found routes return HTTP 200 on the live site.
- `C2-05` — ISOBMFF child-box size not validated against parent container end in
  `color-detection.ts`/`gain-map-detection.ts` (feeds the HDR ingest gate; empirically reproduced).
- `C2-06`/`C2-07` — public SSR pages unthrottled at every layer; the rate-limit lint gate is
  structurally blind to `page.tsx` (3-lane agreement with pool-ceiling ARCH-02/PERF-13).
- `C2-11`..`C2-21` — perf cluster: SW 304 write amplification, 10k Leaflet markers, per-render
  `MAX(updated_at)` topics subquery, semantic-scan decode cost, view-record round-trips,
  non-sargable timeline scans, unbounded tag `IN (...)`, touchmove re-renders, masonry memo,
  GPS-strip full-file buffering, unindexed `updated_at` sorts.
- Verified clean: document-specialist found zero doc/code mismatches; verifier confirmed ~60
  CLAUDE.md claims byte-for-byte (3 wording notes); security lane found no CRIT/HIGH vulns.

## Agent Failures

The first 12-lane fan-out of this cycle was killed by an API session limit before any artifacts
were written; all 12 lanes were re-spawned per the retry rule. Eleven completed and wrote files;
the secondary feature-dev code-reviewer lane returns via final message and is folded in as an
addendum when received (see the cycle aggregate's AGENT FAILURES section).

## Plan Disposition

All findings are scheduled or explicitly deferred in `.context/plans/cycle-2-2026-07-07-plan.md`
and `.context/plans/cycle-2-2026-07-07-deferred.md`. Deferred registers remain:
`.context/plans/cycle-96-2026-07-01-deferred.md` (broad carry-forwards) plus the cycle-1 and
cycle-2 registers. The carry-forward age-budget policy in `.context/plans/README.md` applies.
