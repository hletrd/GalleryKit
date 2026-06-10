# Aggregate review — Run-4 Cycle 4

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md` (code-reviewer + debugger + tracer)
- `security-reviewer-critic-verifier.md` (security + critic + verifier)
- `perf-reviewer-architect.md` (perf-reviewer + architect)
- `test-engineer.md` (test-engineer + gates verifier)
- `document-specialist.md` (document-specialist)
- `designer.md` (designer)

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1/c2/c3 — see `run4-cycle1/_aggregate.md`).
Each angle was executed as a distinct full-inventory pass in-context; no
angle sampled. Inventory this cycle: regression review of all 6 commits
cycle 3 self-authored (its review committed mid-stream, so those commits had
no independent reviewer), full reads of the paid flow (webhook / checkout /
download / refund), serving path (serve-upload + settings-hash + both route
twins), LR PAT route + token surfaces (route, lib, action, client), queue
failure path, browser upload action, smart-collections (full), semantic
route (full), analytics (full), proxy, db pool config, schema unique-key
audit, repo-wide pattern sweeps (toISOString/JSON.parse/setInterval/
Math.random/affectedRows/Enter-handlers), docs (CLAUDE.md, AGENTS.md,
README workflow), i18n key-parity script over all 22 lrToken UI keys.

## Context
Run-4 cycle 3 closed the serving hot-path + webhook-race cluster. This
cycle prioritized (1) independent regression review of cycle 3's
self-authored commits, (2) the Stripe failure-path corners (where the
highest-value finding landed), (3) interaction-pattern consistency on the
credential-management UI, (4) contract-vs-behavior honesty of the new
debounce.

## Cross-angle agreement
- **PERF-R4C4-01** was independently flagged by the perf angle (blocking
  refresh) and the document-specialist (docstring overclaims the exact
  scenario) — two angles, one fix: highest-signal finding this cycle.
- **COR-R4C4-02** raised by code/tracer; security concurred with the
  framing (refunded customer retains a live download credential — business
  rule defeated by stale state).
- **UX-R4C4-04** raised by designer; code angle's repo-wide Enter-handler
  sweep proved both siblings already implement the guard, isolating
  tokens-client as the drift.
- **COR-R4C4-03** raised by code/debugger; architect concurred and
  re-rejected the shared-ingest-helper refactor (containment widening is
  right-sized).
- **I18N/SEC-R4C4-05** raised by designer; security concurred (keep
  generic-error posture while localizing).

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| PERF-R4C4-01 | MED/High | `serve-upload.ts:42-65` debounce awaits the inflight config refresh once TTL expires — every derivative GET/HEAD/304 stalls in lockstep under a hung DB, falsifying its own docstring; fix = stale-while-revalidate (serve known hash immediately, refresh in background) | perf, document-specialist |
| COR-R4C4-02 | LOW-MED/Medium | `actions/sales.ts:136,203-233` — `charge_already_refunded` path never converges DB (`refunded`/`downloadTokenHash` stay live) → Stripe-refunded purchase remains downloadable; admin retry loops on an error toast forever (post-24h-idempotency-window retry or dashboard-side refund) | code, debugger, security (concur) |
| COR-R4C4-03 | LOW-MED/Medium | `api/admin/lr/upload/route.ts:286-392` — unguarded throw window between tracker claim and insert catch (`extractExifForDb`, `cleanupOriginalIfRestoreMaintenanceBegan`, `assertBlurDataUrl`) leaks quota for the 1-h window + orphans the original + returns non-JSON 500 to the plugin; browser path contains all three | code, debugger, architect (concur) |
| UX-R4C4-04 | LOW-MED/High | `tokens-client.tsx:44-63,155` — Enter key bypasses `isPending` guard (+ no preventDefault) on the credential-minting dialog → key-repeat mints multiple live tokens, only the last plaintext ever shown; both sibling components implement the correct pattern | designer, code (sweep) |
| I18N-R4C4-05 | LOW-MED/High | `actions/lr-tokens.ts:40-110` — seven hardcoded English error literals on a localized browser surface (mixing with `t('unauthorized')` two lines above); Korean admin gets English toasts on the tokens page | designer, security (concur) |
| COR-R4C4-06 | LOW-MED/Medium | `api/download/[imageId]/route.ts:206-282` — token claimed BEFORE stream open; `createReadStream` errors are async so the catch documented to map post-claim ENOENT to 404 is unreachable → 200 + aborted body + burned single-use token in the lstat→open race; fix = `fsp.open` handle BEFORE the claim, stream from handle | code, debugger |
| HARD-R4C4-07 | LOW/Medium | `lib/smart-collections.ts:301-346` — `validateNode` never type-checks `value`/`lo`/`hi`/`values[]`; non-scalars flow into drizzle params (mysql2 object-expansion footgun), violating the module's declared parameterization invariant; admin-only input, hardening | code, security (concur LOW) |
| DOC-R4C4-08 | LOW/High | CLAUDE.md "Testing" + AGENTS.md gate list omit the blocking `npm run typecheck` gate (same class as DOC-R4C1-08; cycle 3's `b7681b9a` was a typecheck-gate fix no doc predicts) | document-specialist |
| LOW-R4C4-09 | LOW/Low | `lib/analytics.ts:102-115` — trailing-dot FQDN referrer (`github.com.`) records `"com."`; strip trailing dot before TLD+1 split | code |
| TEST-R4C4-10 | MED-gap/High | Debounce suite does not pin "stale-window response must not await refresh" — add with PERF-R4C4-01 | test-engineer |
| TEST-R4C4-11 | MED-gap/High | No coverage of the `charge_already_refunded` catch branch — add with COR-R4C4-02 | test-engineer |
| TEST-R4C4-12 | LOW-MED-gap/High | No coverage of an LR-route throw between claim and insert — add with COR-R4C4-03 | test-engineer |
| TEST-R4C4-13 | LOW-gap/High | tokens-client Enter/pending guard unpinned — add to `client-source-contracts.test.ts` with UX-R4C4-04 | test-engineer |
| TEST-R4C4-14 | LOW-gap/High | smart-collections non-scalar reject cases — add with HARD-R4C4-07 | test-engineer |
| TEST-R4C4-15 | LOW-MED-gap/Medium | download route open-before-claim ordering + ENOENT-keeps-token contract — add with COR-R4C4-06 | test-engineer |

All findings are scheduled in this cycle's fix plan (plan-279); the test
gaps fold into their parent fixes. No new deferrals were created this cycle;
the three standing deferrals (DEF-R4C1-01, DEF-R4C2-01, DEF-R4C3-01) were
re-audited and their exit criteria remain un-triggered (see
document-specialist file).

## Verified-clean highlights (evidence in per-angle files)
- All 6 cycle-3 self-authored commits independently regression-reviewed:
  sound. The webhook `affectedRows === 1` gate was PROVEN against the pool
  config (no CLIENT_FOUND_ROWS flag) and the schema (session_id is the sole
  unique key).
- `.toISOString()`-near-DB-write class: still CLOSED repo-wide.
- All JSON.parse sites guarded; no Math.random in security paths.
- Auth core, origin gates, scanner self-integrity, analytics privacy
  contract, traversal/symlink serving guards: clean.
- i18n UI key parity (en/ko): zero missing across the tokens surface.

## Gate baseline (clean tree)
- vitest 1591/1591 PASS (164 files) · typecheck PASS · eslint 0/0
- lint:api-auth PASS · lint:action-origin PASS · lint:public-route-rate-limit PASS
- build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset/tone-authoring features.
Nothing dropped: 15 findings → 9 fix items (6 test gaps folded into their
parent fixes) + 0 new deferrals.

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context (documented
constraint, same as run2/run3/run4-c1/c2/c3); all angles executed in-context
with full inventory and per-angle provenance files above.
