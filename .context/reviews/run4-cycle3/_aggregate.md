# Aggregate review — Run-4 Cycle 3

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md` (code-reviewer + debugger + tracer)
- `security-reviewer.md` (security + critic + verifier)
- `test-engineer.md` (test-engineer + gates verifier)
- `perf-architect-docs-designer.md` (perf-reviewer + architect + document-specialist + designer)

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented constraint
as run2/run3/run4-c1/run4-c2 — see `run4-cycle1/_aggregate.md`). Each angle was
executed as a distinct full-inventory pass in-context; no angle sampled.
Inventory this cycle: regression diff of all 8 R4C2 commits, 8 API routes (full
reads: webhook, checkout, download, lr/upload, search/semantic, og/photo,
feed.xml, uploads×2), lib deep reads (image-queue full, serve-upload full,
settings-hash full, gallery-config resolution, session, api-auth, admin-tokens,
request-origin, analytics, upload-limits, process-image save/EXIF region),
actions (sharing full, public full, images retry region, sales refund region),
proxy, schema datetime audit, dashboard-client UI region, scripts inventory +
scanner posture, e2e inventory, CLAUDE.md contract spot-checks.

## Context
Run-4 cycle 2 closed the failed-image persistence cluster. This cycle's pass
prioritized (1) regression review of those 8 commits, (2) the same-bug-class
sweep (`.toISOString()` → string-mode datetime: class CLOSED, no other
instance), (3) the public serving hot path end-to-end (where the highest-value
findings landed), (4) the paid-download flow race/heuristic corners.

## Cross-angle agreement
- **COR-R4C3-01** (HEAD pass-through drift) was independently flagged by the
  code angle (twin-route diff) and the architect angle (drift-guard gap), with
  the test angle supplying the missing-contract diagnosis (TEST-R4C3-07) —
  three angles, one cluster: highest-signal finding this cycle.
- **PERF-R4C3-05** was flagged by the perf angle and independently confirmed as
  a doc-code mismatch by the document-specialist pass (settings-hash docstring
  promises a debounce the hot path bypasses).
- **COR-R4C3-02/03** raised by code angle; security angle concurred on severity
  framing (correctness, not exposure).

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C3-01 | MED/High | `/uploads/[...path]/route.ts:15-22` HEAD export omits the `'HEAD'` argument to `serveUploadFile` — R20-L1 headers-only path dead on the PRIMARY serving route (locale twin passes it); every SW HEAD revalidate opens a discarded `createReadStream` fd; stale pre-R20-L1 comment | code, architect, test |
| PERF-R4C3-05 | MED/High | `serve-upload.ts:125-127` runs one `admin_settings` SELECT per image request (React `cache()` is request-scoped) and `getColorSettingsHash(config)` bypasses its own documented 5 s debounce — 30-50 extra DB round-trips per gallery paint incl. 304s/HEADs; settings-hash docstring claims are false on the only production caller | perf, document-specialist |
| COR-R4C3-02 | MED/Medium | Stripe webhook SELECT-race loser (dup-key no-op INSERT) still logs `Entitlement created` + the `[manual-distribution]` plaintext-token line whose hash was never stored — re-introduces C3-RPF-07 dead-token operator workflow in exactly the race the belt-and-suspenders comment anticipates; gate logs on insert `affectedRows === 1` | code/debugger, security (concur) |
| SEC-R4C3-04 | LOW-MED/High | `api-auth.ts:63-79` token-auth branch skips the C7-SEC-02 no-store/no-cache response defaults the cookie branch applies — latent caching exposure for the first `lr:read` route that forgets its own headers | security |
| COR-R4C3-03 | LOW/High | Download route usedRow heuristic (`route.ts:92-99`) missing `isNotNull(downloadedAt)` its own comment claims — refunded-never-downloaded rows (refund clears hash, leaves `downloadedAt` NULL) mislabel mistyped tokens as 410 "Token already used" on multi-buyer/refunded images | code, security (concur) |
| ARCH-R4C3-06 | LOW/High | Uploads GET/HEAD twin routes have no drift guard (drift has now happened once) — lock with wiring test rather than refactor; folds into COR-R4C3-01 | architect |
| TEST-R4C3-07 | MED-gap/High | No source-contract test on the uploads routes' method pass-through (enabled COR-R4C3-01 to survive since R20) | test-engineer |
| TEST-R4C3-08 | LOW-MED-gap/High | Webhook log lines not contract-locked to true-insert outcome — add with COR-R4C3-02 fix | test-engineer |
| TEST-R4C3-09 | LOW-gap/Medium | `withAdminAuth` response-header defaults untested on either auth branch — add with SEC-R4C3-04 fix | test-engineer |
| TEST-R4C3-10 | LOW-gap/Medium | usedRow disambiguation query shape untested — add with COR-R4C3-03 fix | test-engineer |
| UX-R4C3-OBS-A | LOW/Low | LR upload route error strings are hardcoded English (machine-client surface; plugin has no localization today) — observation, defer with exit criterion | designer |

All MED items and every test gap are scheduled in this cycle's fix plan;
UX-R4C3-OBS-A is the sole deferral (explicit ledger entry with exit criterion).

## Verified-clean highlights (evidence in per-angle files)
- All 8 R4C2 commits regression-reviewed: no drift from plan-275 claims.
- `.toISOString()` → string-mode-datetime bug class: CLOSED repo-wide.
- Restore/quiesce ordering closes the `queue.start()` un-pause race.
- LR upload per-file cap, tracker claim/settle symmetry, contract-lock release: sound.
- Session/origin/token auth cores: no issues found.
- Touch-target audit: no new violations (baseline green).

## Gate baseline (clean tree)
- vitest 1576/1576 PASS (161 files) · typecheck PASS · eslint 0 errors/0 warnings
- lint:api-auth PASS · lint:action-origin PASS · lint:public-route-rate-limit PASS
- build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset/tone-authoring features.
Nothing dropped: 11 findings → 5 fix tasks + 4 test tasks (bundled) + 1
deferral + 1 folded (ARCH-R4C3-06 → COR-R4C3-01).

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context (documented
constraint, same as run2/run3/run4-c1/run4-c2); all angles executed in-context
with full inventory and per-angle provenance files above.
