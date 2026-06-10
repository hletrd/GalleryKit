# Aggregate review — Run-4 Cycle 7

Per-angle provenance files in this directory:
- `code-reviewer-debugger-tracer.md`
- `security-reviewer-critic-verifier.md`
- `perf-reviewer-architect.md`
- `test-engineer.md`
- `document-specialist.md`
- `designer.md`

NOTE: This cycle runs as a single orchestrator-spawned subagent; nested
Agent/Task spawning is unavailable in this context (same documented
constraint as run2/run3/run4-c1..c6). Each angle was executed as a
distinct full-inventory pass in-context; no angle sampled. Inventory
this cycle: independent regression review of all 11 cycle-6 fix
commits; a never-mentioned-in-run4 coverage map (139 files) with deep
reads of the money path (stripe/webhook/checkout/download/tokens/
base56/license-tiers), smart-collections + all call sites, CLIP/caption
stubs, og-photo-fetch, sanitize/photo-title, upload-tracker/restore-
maintenance/queue-shutdown, i18n request config, build-sw script,
histogram/upload-dropzone/admin-user-manager/bulk-edit-dialog
components, e2e specs, and the three lint-gate scripts; pattern sweeps
(parseInt radix, server setInterval, listener parity, IME-guard census);
plus VENDORED-FRAMEWORK verification (Next.js auto-implement-methods
read in node_modules) that converted the HEAD-burn hypothesis into fact.

## Context
Run-4 c1-c5 saturated actions/API/admin-DB; c6 took the interaction +
delivery layers. C7 rotated to the PAID-DOWNLOAD journey end-to-end and
the least-covered lib/components — and found the cycle's highest-signal
cluster exactly on the money path's HTTP-method semantics.

## Cross-angle agreement
- **COR-R4C7-01/02 (token burn)** — code (vendored-source proof of
  auto-HEAD), security (availability defect on a paid flow + fix-shape
  hardening), architect (RFC 9110 safe-method violation as root cause),
  document-specialist (README prescribes the vulnerable workflow),
  designer (dead-end 410 journey). Five angles, one root cause:
  the single-use claim is bound to a safe method.
- **COR-R4C7-03 (smart-collection asymmetry)** — code (confirmed repro
  path), security (write-time-failure doctrine), architect (two operator
  lattices), test (missing agreement property).
- **COR-R4C7-04 (topic liveness)** — code + designer.

## Merged finding list

| ID | Sev/Conf | Title | Source angles |
|----|----------|-------|---------------|
| COR-R4C7-01 | HIGH/High | HEAD on `/api/download/[imageId]` executes the GET handler (Next auto-implements HEAD from GET — verified in vendored source) and burns the single-use paid token with zero bytes delivered. The repo already exports explicit HEAD on both uploads catch-all routes; the only mutating GET route lacks it. Fix: explicit safe HEAD | code, security, architect |
| COR-R4C7-02 | MED-HIGH/High | Claim-on-GET breaks the README-documented email workflow under mail-gateway link prefetch (SafeLinks/Mimecast/Proofpoint class): scanner GET consumes the single use; customer gets 410. Fix: GET → no-claim localized interstitial (POST form); POST → existing claim+stream path; restrictive inline CSP (API routes bypass middleware CSP); rate-limit-gate posture documented | security, code, architect, designer, document-specialist |
| COR-R4C7-03 | MED/High | `validateNode` accepts tag-column ASTs with `gt/gte/lt/lte/between/in` that `compileTagPredicate` throws on; save actions parse-only → admin "successfully" saves a collection whose public page 404s for everyone. Fix: per-column operator enforcement at validate time + validate/compile agreement test | code, security, architect, test |
| COR-R4C7-04 | MED-LOW/High | upload-dropzone topic select is interactive mid-batch but read from the click-time closure (silently inert), while tags deliberately honor latest-wins via refs on the same surface. Fix: topicRef aligned to the tag contract | code, designer |
| TEST-R4C7-05 | gap/High | No coverage of the download route's method contract, no validate/compile agreement property, no topic-liveness pin. Folds into the three fixes above (source-contract + unit split per repo convention) | test |
| DOC-R4C7-06 | LOW/High | README "Manual download distribution" + route docblock describe claim-on-first-GET and prescribe emailing raw links with no scanner caveat — must be rewritten in the same commits as COR-R4C7-01/02 | document-specialist |

## Regression review of cycle-6 commits
All 11 re-reviewed independently: **sound** (per-commit traces in the
code angle file; lightbox blur-vs-focus-trap interplay and the
x-gk-admin-render disclosure surface explicitly re-derived).

## Verified-clean highlights (evidence in per-angle files)
- Webhook ingest chain (signature → payment_status → email shape/cap →
  tier allowlist → zero-amount → idempotency SELECT → insertId
  disambiguation) — no bypass.
- Checkout Pattern-2 rollback discipline incl. both catch paths.
- Download route path containment + constant-time verify + handle
  lifecycle.
- Smart-collection SQL parameterization, LIKE escaping, caps.
- IME census complete (3 unguarded onKeyDown sites are button-targets).
- Listener add/remove parity (10/10 components balanced); no server
  interval leaks; parseInt radix census clean.
- e2e suite flake sweep: role/name selectors, expect.poll, no sleeps.
- EN/KO parity 0/0 (gate green); touch-target ledger matches reality.

## Gate baseline (clean tree)
- vitest 1675/1675 PASS (174 files) · typecheck PASS · eslint 0/0
- lint:api-auth PASS · lint:action-origin PASS · lint:public-route-rate-limit PASS
- build / e2e: run during PROMPT 3 after fixes.

## HARD-SCOPE check
No finding proposes edit/culling/scoring/preset features. The
interstitial is a delivery-correctness fix on an existing paid surface;
no new product surface. 6 findings → 4 fix tasks (test + doc findings
fold into their parents) + 0 new deferrals beyond the standing ledger
(re-audited, all exit criteria un-triggered).

## AGENT FAILURES
None. Nested-agent spawning unavailable in the subagent context
(documented constraint, same as run2/run3/run4-c1..c6); all angles
executed in-context with full inventory and per-angle provenance files
above.
