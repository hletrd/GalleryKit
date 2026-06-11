# Aggregate review — Run-4 Cycle 17

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent;
nested Agent/Task spawning is unavailable in this context (same
documented constraint as run2/run3/run4-c1..c16). Each angle was
executed as a distinct full-inventory in-context pass; no angle
sampled. Inventory: line-level regression review of the six cycle-16
fix commits (`7144479c`, `61d85a05`, `61218056`, `e0f7f684`,
`233c38b2`, `217098aa`); rotation to the lowest-run-4-coverage
surfaces by a fresh mention-count map over run4-c1..c16 review texts —
the **OG/SEO cluster** (both OG routes, og-photo-fetch, photo-title,
safe-json-ld, robots), the **restore/maintenance cluster** (db-restore,
restore-maintenance, advisory-locks, queue-shutdown, mysql-datetime),
the **platform-lib leftovers** (request-origin, sanitize,
gallery-config, auth-rate-limit, caption-generator, clip-embeddings,
clipboard, utils, hdr-filenames, bulk-edit-types), the **admin-client
second half** (analytics, dashboard, password×2, seo clients), shared
components (tag-input, optimistic-image, topic-empty-state,
map-loader), actions (tags, seo, admin-backfill), runtime glue
(db/index, i18n/request, instrumentation), and a ui-primitives
sub-44/suppression sweep.

## Context

C16 closed the dialog-settle/CDN-base/CSP/select/live-region/zoom-anchor
set. C17's rotation landed on the OG cluster and found the loop's
known failure mode in a new costume: not a missing pattern this time,
but two sibling routes whose CONTRADICTORY policies are each locked by
their own test — the per-photo OG route refunds exactly the rate-limit
charges the topic OG route's comment (and lock test) declares
non-refundable.

## Cross-angle agreement

- **SEC-R4C17-01** — security (primary; threat model + lineage),
  test-engineer (the locking fixture itself is the co-defect —
  TEST-R4C17-01), document-specialist (the `rollbackOgAttempt`
  docstring seeded the divergence — DOC-R4C17-02), critic (fix-shape:
  deletion + re-lock, no new machinery), verifier (CONFIRMED: both
  routes, both tests, `git log -L` lineage to `3c2cc3aa`), architect
  (cross-route invariants belong in source-contract tests — flip the
  photo one to match). **5/6 angles.**
- **DES-R4C17-03 / DES-R4C17-04** — designer (primary), code concurs
  (single-flight retry guard verified; the fix is additive labels +
  toast). **2/6.**
- **COR-R4C17-05** — code (primary; loop-local warning asymmetry),
  security concurs not-a-security-issue, test (TEST-R4C17-03 coverage
  note). **3/6.**
- **PERF-R4C17-06** — perf (primary), security (Host-header trust
  surface would be eliminated by the same refactor; LOW in shipped
  topology). DEFERRED with exit criterion. **2/6.**

## Merged finding list

| ID | Sev/Conf | Title | Source angles | Disposition |
|----|----------|-------|---------------|-------------|
| SEC-R4C17-01 | **MED/High (CONFIRMED)** | `/api/og/photo/[id]` refunds the rate-limit charge on `!image` (route.tsx:83), `!fetched` (:116), and catch (:221) — all post-DB/post-fetch paths — so the 30/min budget binds only for cacheable successes; nonexistent-id probes get unlimited free DB lookups, the exact "enumeration oracle / unmetered DB load" the sibling `/api/og` route forbids in its charged-404 comment (route.tsx:67-74). Both behaviors are test-locked against each other (`og-route-source-contracts.test.ts:9` vs `og-photo-fallback.test.ts:53-57`). Fix: rollback only on the two pre-DB validation rejections; charge `!image`/`!fetched`/catch; flip the photo lock test to the new contract with negative assertions; rewrite the `rollbackOgAttempt` docstring (rate-limit.ts:224-228) whose "e.g., topic not found" example contradicts shipped policy. | 5/6 | SCHEDULE |
| TEST-R4C17-01 | gap/High | `og-photo-fallback.test.ts` rollback assertion encodes the SEC-R4C17-01 bug as a contract — flip in the same commit, proven failing pre-fix. | test | SCHEDULE (with SEC-R4C17-01) |
| DOC-R4C17-02 | LOW/High (CONFIRMED) | `rollbackOgAttempt` docstring's canonical example is the policy AGG8F-01 reversed; it already seeded one divergence. | document | SCHEDULE (with SEC-R4C17-01) |
| DES-R4C17-03 | LOW/High (CONFIRMED) | Dashboard pagination disabled chevron `Button`s (dashboard-client.tsx:136-138,151-153) have no accessible name; enabled ones have only a bare page number. Add localized aria-labels (en+ko). | designer, code | SCHEDULE |
| DES-R4C17-04 | LOW/Medium (CONFIRMED) | Failed-image retry: error path toasts, success path silently removes the row (dashboard-client.tsx:42-58) — asymmetric feedback, SR-silent success. Add `dashboard.retrySuccess` toast (en+ko). | designer, code | SCHEDULE |
| COR-R4C17-05 | LOW/Medium (CONFIRMED) | `batchUpdateImageTags` add/remove loops (tags.ts:397-408,423-428) silently `continue` on control-char-rejected names while format-invalid names push a warning — inconsistent partial-success reporting in the same loop. Warn on the rejected path (generic key, never echo the dirty value). | code, security, test | SCHEDULE |
| PERF-R4C17-06 | MED-LOW/Medium | OG photo generation loopback-fetches derivatives over HTTP (through the public origin) instead of reading from disk; bounded and CDN-shielded today; refactor must re-derive safe-path containment. | perf, security | DEFER (exit criterion in ledger) |
| OBS-R4C17-A | INFO | `caption-generator.ts:36` stub truncation uses `.slice(0,140)` against the repo's codepoint-safe convention (C21-AGG-01); EXIF camera models are ASCII in practice; stub is slated for ONNX replacement. | code, document | DEFER (record) |
| TEST-R4C17-02/03 | gap/Medium | Coverage notes for the two LOW fixes — jsdom render-lock disproportionate (c16 precedent); tags warning case if harness allows. | test | RECORD (decisions documented) |

## Regression review of cycle-16 commits — SOUND

All six commits verified line-level; `sales-client` comment claim
verified against `handleRefund`'s finally (lines 155-156); zoom-math
extraction compared verbatim against pre-image arithmetic; no
follow-on findings. The `image-manager` controlled-dialog conversions
keep flag lifecycles in `finally` and close on settle in both outcome
paths.

## Clean-pass surfaces this cycle

Full lists in the per-angle files. Highlights: OG topic route
(validation→limit→DB order, ETag 304, clamped display text);
photo-title / safe-json-ld / robots; restore/maintenance cluster incl.
advisory-lock registry vs CLAUDE.md parity; request-origin fail-closed
contract; sanitize.ts layered contracts; auth-rate-limit dual-bucket
rollback; gallery-config validated fallbacks; admin clients second
half (password Alerts ride `role="alert"` primitive — DES-R4C16-05
class does NOT recur); tag-input combobox ARIA + IME guard;
optimistic-image retry ladder; db/index group_concat init handshake;
instrumentation graceful-shutdown race; ui-primitives sweep (only
non-interactive `table.tsx` h-10 + one documented require-imports
disable in analytics.ts); actions tags/seo/admin-backfill guard
ordering.

## Standing deferrals re-audit (exit criteria)

Diff since the c16 review commit (`f8f97d96..HEAD`) touches the c16
fix surfaces + plan-303 notes — no deferral surface modified except
`image-zoom.tsx` (already audited in c16: passivity untouched, so
DEF-R4C8-C stays carried):
- DEF-R4C16-A (`db/seed.ts` deletion awaits owner sign-off),
  DEF-R4C16-B (manifest dark splash) — un-triggered; carried.
- DEF-R4C15-A (map clustering ≳2k markers), DEF-R4C15-B (loading.tsx
  sessionStorage) — un-triggered; carried.
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map fixture)
  — un-triggered; carried.
- DEF-R4C11-A; DEF-R4C10-A/B; DEF-R4C1-01/DEF-R4C2-01/DEF-R4C3-01
  (LR PAT breadth/scopes/English — no LR change); OPS-R4C6-01 (host
  nginx `/uploads/`); DEF-R4C8-A/B/C/D; histogram mode-cycle
  aria-label; OBS-R4C12-B/C/D/E; DOC-R4C13-01/02 — all un-triggered;
  carried.

## Gate baseline (clean tree)

Cycle-16 close: all 8 gates green; deploy verified live
(SW `d6a93461`/`3aa3c4ff-p7`). All 8 gates re-run during PROMPT 3
after this cycle's fixes land.

## HARD-SCOPE check

No finding proposes edit / culling / scoring / preset features. All
scheduled fixes tighten existing surfaces: abuse-resistance parity
(OG rate-limit policy), accessibility (pagination names, retry
announcement), admin feedback fidelity (tags warning parity).

## AGENT FAILURES

None — all six angle passes completed (single-subagent in-context
execution; no nested agent spawns attempted because the Agent tool is
unavailable in this environment, per the documented run-wide
constraint).
