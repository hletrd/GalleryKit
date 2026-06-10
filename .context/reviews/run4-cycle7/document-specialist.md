# Run-4 Cycle 7 — document-specialist angle

## Inventory & method
- README.md (root + apps/web), CLAUDE.md sections touching the surfaces
  this cycle reviews (paid downloads, smart collections US-P42, testing/
  lint-gate registry), route-file docblocks on the money path, and the
  standing-deferral exit criteria from plan-274/276/278/284.

## Findings

### DOC-R4C7-06 — README "Manual download distribution" prescribes the exact workflow the code cannot survive (LOW severity as a doc defect; the code half is COR-R4C7-01/02) (High confidence)
- `apps/web/README.md` lines 63-77 instruct the operator to email the
  raw `/api/download/<imageId>?token=<token>` URL and state "tokens …
  are single-use (the route's atomic UPDATE invalidates the hash on
  first download)". It carries a thorough log-retention warning but NO
  caveat that mail-security gateways fetch inbound links and will
  consume the single use before the customer can. With the COR-R4C7-02
  interstitial fix, this section must be updated in the SAME commit:
  the link now lands on a confirmation page; the claim happens on the
  customer's explicit "Download" submit; scanner fetches are harmless.
- The route docblock (`download/[imageId]/route.ts` lines 1-20)
  documents the single-use enforcement order as GET-claims — must be
  rewritten to the GET-interstitial / POST-claim / HEAD-safe contract.

### Doc-consistency checks that PASSED
- CLAUDE.md "Testing"/"Lint Gates" registry matches package.json scripts
  (lint:api-auth, lint:action-origin, lint:public-route-rate-limit all
  present and accurately described, including the GET-not-scanned
  caveat in the rate-limit gate — which this cycle's POST addition must
  satisfy explicitly).
- CLAUDE.md smart-collections row ("US-P42, Admin-defined dynamic
  galleries") makes no claim about an admin UI — consistent with the
  zero-.tsx-caller reality (actions are the surface).
- README webhook/refund sections match route behavior (payment_status
  gate, refund token invalidation) — re-verified line-by-line.
- Cycle-6 PWA section in CLAUDE.md matches the shipped template
  semantics (offline-only exemption, x-gk-admin-render) — verified
  against `public/sw.template.js` current text.

## Standing deferrals re-audit (exit criteria — fresh evidence)
- **DEF-R4C1-01** (LR `revalidateAllAppData` breadth): all public pages
  still export `revalidate = 0` (grep this tree: 9 occurrences
  unchanged). Exit criterion un-triggered → remains deferred.
- **DEF-R4C2-01** (tokens UI grants 3 scopes): `lr:read`/`lr:delete`
  still appear only in lib declarations, api-auth comment, and the
  granting UI; sole consuming route remains `api/admin/lr/upload`
  (`lr:upload`). Un-triggered → remains deferred.
- **DEF-R4C3-01** (LR route error strings EN-only): no LR plugin
  localization landed; no browser consumer. Un-triggered → remains
  deferred.
- **OPS-R4C6-01** (host-nginx uploads block): non-code ops runbook item;
  no host maintenance occurred this cycle. Remains deferred with the
  plan-284 runbook intact.
