# Run-10 Cycle 1/100 Deferred Findings

Start HEAD: `657eb0243f49898c0f902fda60669d63b17a512d`.
Review aggregate: `.context/reviews/cycle-1-2026-07-06/_aggregate.md`.

Repo rules consulted before deferral (in order): `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`
and prior deferred registers, `CONTRIBUTING.md`/`.cursorrules` (absent). Deferrals preserve original
severity/confidence. When picked up, repo policy applies (GPG-signed conventional+gitmoji commits, no
`--no-verify`, full gates). No security/correctness/data-loss finding is deferred below: C1-31 is a
library-coupling maintainability risk with a bounded, transient failure mode; the C1-13 deferred half
is hardening on a surface that fails safe (the security lane itself classified it
"Documentation-and-hardening only"), and its documentation half ships this cycle.

## Newly deferred (cycle-1)

### C1-31 — `db/index.ts` couples to undocumented mysql2 wrapper internals for connection-init await
- Original severity/confidence: Low / Medium (architect ARCH-03).
- Citations: `apps/web/src/db/index.ts:60-95`.
- Reason: the correct fix is either a transport change on a repeatedly-hardened surface (C4R/C6R/C8-F01/
  C4-C1/R10-C3/R12C12 lineage) or a DB-backed integration test proving cold-connection `GROUP_CONCAT`
  > 1024 bytes is untruncated; neither is safely landable without DB-integration test infrastructure,
  which does not exist in the unit gate.
- Exit criterion: any mysql2 version bump in `package.json`, OR introduction of DB-backed test infra —
  whichever comes first triggers adding the cold-pooled-connection `GROUP_CONCAT` regression test and/or
  moving the init await to a documented mechanism.

### C1-32 (broad part) — wholesale retirement of redundant source-shape contract tests
- Original severity/confidence: Low-Medium / High (architect ARCH-04 + critic CRIT-04).
- Citations: 139/307 test files read source text (`grep -rlE 'readFileSync' src/__tests__`); e.g.
  photo-viewer/lightbox pinned by cycle-11/20/24/26/41 contracts.
- Scheduled part shipped this cycle: policy adopted in `.context/plans/README.md` (prefer behavior
  tests; retire redundant duplicates when touching a triple-enforced surface), applied concretely in
  WP6 (retiring the `COUNT(*) OVER()` pin) and WP12 (updating the pinned import contracts).
- Reason for deferring the rest: bulk-editing ~139 test files in one cycle is high-regression-risk churn
  with no behavior gain; the policy converts it into incremental drainage.
- Exit criterion: each future cycle that touches a guarded surface retires that surface's redundant
  duplicate in the same change; a dedicated consolidation pass becomes schedulable once the lint-gate
  fixture coverage is confirmed equivalent for a given surface.

### C1-33 (measurement part) — multipart upload heap-materialization RSS envelope
- Original severity/confidence: Low / Medium (perf PERF-04, needs-manual-validation).
- Citations: `apps/web/src/app/actions/images.ts:141`, `api/admin/lr/upload/route.ts` formData path,
  `lib/process-image.ts:905-914`.
- Scheduled part shipped this cycle: CLAUDE.md operational note documenting the expected transient RSS
  envelope per in-flight upload (WP13).
- Reason: confirming the framework-internal buffering requires an RSS trace during a 200 MB upload on a
  production-like host; not measurable in this environment; no app-level fix is available while uploads
  ride server actions/`formData()`.
- Exit criterion: measured RSS trace on the deploy host (or a Next.js release note changing multipart
  spooling); if confirmed and problematic, evaluate serializing concurrent large uploads.

### C1-13 (startup fail-loud part) — production boot-time error when proxy headers arrive with `TRUST_PROXY` unset
- Original severity/confidence: Low / Medium (security SEC-03, explicitly "hardening", fails safe today:
  CSRF check fails closed; degradation is rate-limit-bucket collapse with an existing first-request
  `console.error`).
- Citations: `apps/web/src/lib/request-origin.ts:45-69`, `apps/web/src/lib/rate-limit.ts:169-196`.
- Scheduled part shipped this cycle: deployment-checklist doc reinforcement (WP13).
- Reason: proxy-header presence is only observable on a request, so a literal boot-time check is not
  implementable without a synthetic self-request design decision; the existing first-request error is the
  current detection point.
- Exit criterion: an ops incident attributable to silent `TRUST_PROXY` misconfiguration, or a design
  decision on synthetic boot-time self-probing — either re-opens this as a scheduled item.

### C1-25(a) — build the admin Smart Collections UI
- Original severity/confidence: High / High (docs DOC-01; the High attaches to the doc/product mismatch,
  which IS fixed this cycle by the CLAUDE.md correction in WP13 — no doc/code mismatch remains).
- Citations: `apps/web/src/app/actions/collections.ts` (zero importers), `components/admin-nav.tsx:15-26`.
- Reason: shipping a new admin surface is a product decision, per the repo's own precedent (CLAUDE.md
  "Storage Backend (Not Yet Integrated)" rule: do not expose unfinished features as supported admin
  functionality until wired end-to-end).
- Exit criterion: explicit product decision to ship the Collections admin page (nav entry + CRUD UI per
  the tags/topics pattern) — WP11's new behavior tests (C1-23) become its regression base.

### C1-11 (operator part) — confirm the real edge topology of the production deployment
- Original severity/confidence: Medium / Medium (security SEC-01; the shipped-config contradiction is
  fixed this cycle by the nginx comment reconciliation in WP9).
- Reason: whether an upstream TLS-terminating LB fronts nginx on the deploy host is not observable from
  this repo; only the operator can confirm.
- Exit criterion: operator confirms topology. If LB-fronted, switch client-facing locations to
  `$proxy_add_x_forwarded_for` and set `TRUSTED_PROXY_HOPS` to the real hop count (per the reconciled
  comment shipped in WP9).

### C1-30 (fallback only) — drizzle-kit stable repin
- Original severity/confidence: Low / High (architect ARCH-02).
- Scheduled attempt: WP15 verifies and repins this cycle. This entry activates ONLY if a safe stable pin
  compatible with `drizzle-orm@^0.45` cannot be verified during the cycle.
- Exit criterion: verified stable `drizzle-kit` release (docs/registry lookup) → repin + gates.

### C1-36(b) — code→message i18n key-reference validation
- Original severity/confidence: Medium / High (derived from gate-discovered C1-36).
- Reason: the narrow fix (add the missing key + targeted contract) shipped this cycle; a generic
  scanner that extracts every `t('key')` call per `getTranslations('<ns>')` binding and asserts the
  key exists in both locales is a new test-infrastructure surface needing careful AST work to avoid
  false positives (dynamic keys, namespaced lookups).
- Exit criterion: an i18n usage-scan vitest (or lint gate) that fails when any component renders a
  translator key absent from its bound namespace in `en.json`/`ko.json`.

## Carry-forward register (unchanged home: `.context/plans/cycle-96-2026-07-01-deferred.md`)

- Leaving the register this cycle: `C77-ARCH-01` (scheduled as WP3), `C94-11` (scheduled as WP6).
- Remaining (original severity/confidence preserved there): C96-04 feed maintenance policy, C96-07 nginx
  demo-domain template, C96-08 i18n SEO-copy policy, C96-09/C96-10/C96-11 admin form-error UX,
  C96-12 mobile toolbar overflow, C96-13 color `<dl>` semantics, embedding model-version schema work,
  exact listing-count product policy (superseded in part by WP6, which keeps exact counts via the lean
  query), route-level LR upload coverage, admin E2E coverage, mobile admin redesign, zoom keyboard
  panning (C94-DES-02), operator runbook verification items, C80-06 site-config contract, C76-04,
  C76-05, C75-08.
- Age-budget policy (new, per C1-34): any carry-forward High crossing 8 cycles unchanged must be
  scheduled or explicitly reclassified with a product decision; adopted in `.context/plans/README.md`.
