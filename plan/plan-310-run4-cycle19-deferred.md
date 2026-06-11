# Plan 310 — Run-4 Cycle 19 deferred ledger

**Source review:** `.context/reviews/run4-cycle19/_aggregate.md`
**Status:** RECORDED (deferred items only — severities preserved from
the review, not downgraded)

Repo-rule basis for deferral: CLAUDE.md permits deferral for
non-security / non-correctness / non-data-loss items when a concrete
exit criterion is recorded (established ledger convention plan-274 →
plan-308). Nothing in this ledger is a live security/correctness/
data-loss defect: OBS-R4C19-A is a bootstrap-tooling divergence with
no current trigger (verified: no doc instructs compose `environment:`
interpolation for ADMIN_PASSWORD), and DEF-R4C19-B is a refactor of
working code. Deferred work remains bound by repo policy when picked
up (GPG-signed commits, conventional commits + gitmoji, per-cycle
gates, no suppressions).

## OBS-R4C19-A — seed-admin.ts lacks `$$argon2` compose-escape normalization (LOW/Medium)

- **Citation:** `apps/web/scripts/seed-admin.ts:42-56` vs
  `apps/web/scripts/migrate-admin-auth.ts:42-44`.
- **Severity/Confidence (preserved):** LOW / Medium.
- **Problem:** a docker-compose-interpolated `ADMIN_PASSWORD=
  $$argon2…` fed to `npm run db:seed` starts with `$$` not `$argon2`,
  passes `assertStrongBootstrapPassword` on length, and is re-hashed
  as plaintext — the admin then cannot log in with the real password
  and nothing explains why. The sibling script normalizes `$$` → `$`.
- **Reason for deferral:** no shipped doc or compose file routes a
  `$$`-escaped value into db:seed (`.env.local` path documented
  everywhere, which performs no `$` interpolation); the failure
  requires a user-invented setup. Fixing it is trivial but touching
  bootstrap credential code without a live trigger is worse than the
  recorded divergence.
- **Exit criterion:** first support report of bootstrap-login failure
  with a pre-hashed compose-env password, OR the next functional edit
  of seed-admin.ts (carry the normalization over then).

## DEF-R4C19-B — no canonical raw-row extraction seam (LOW/Medium)

- **Citation:** unwrap idiom copies at
  `apps/web/src/lib/admin-tokens.ts:147,178,221,232`,
  `apps/web/src/lib/admin-backfill-runner.ts:153,167`,
  `apps/web/scripts/backfill-color-pipeline.ts:269-271`; missed sites
  fixed this cycle at `apps/web/src/app/actions/topics.ts:48`,
  `apps/web/scripts/backfill-cicp-recheck.ts:62`.
- **Severity/Confidence (preserved):** LOW / Medium (architectural).
- **Problem:** 9 hand-copied tuple unwraps and counting; COR-R4C19-01
  proved the copy can be missed with production impact.
- **Reason for deferral:** migrating all sites to a shared
  `extractRows<T>()` helper churns audited token/payment/backfill code
  for zero behavior change in one cycle; the two live bugs are fixed
  directly this cycle with the documented inline idiom.
- **Exit criterion:** the NEXT new raw `db.execute` consumer must
  introduce `extractRows<T>()` in `apps/web/src/lib/` and use it;
  existing sites migrate opportunistically on their next functional
  edit.

## Recorded decisions (not deferrals)

- **OBS-R4C19-B** — check-api-auth.ts:162 bare `require.main ===
  module` (sibling guards `typeof require !== 'undefined'`): dormant
  under tsx CJS; align opportunistically on the file's next
  functional edit.
- **OBS-R4C19-D** — migrate-capture-date.js trailing-`Z` strict-mode
  hazard for second-precision ISO strings: dormant (every live DB is
  already DATETIME; `:40` type check early-returns). No fix
  scheduled; note lives in the review.
- **OBS-R4C19-E** — dead `skipped` counter: folded into plan-309
  Task 4's edit of the same file.
- **DES-R4C19-08** — false-conflict error UX adjudication: no
  separate fix; root cause fixed by plan-309 Task 1.
- **Backfill scripts unit-testability** (test-engineer): module-scope
  DB imports make operator one-shots awkward to unit-test; not worth
  a DI refactor for one-shot tooling. Keyset shape locked by comment
  + review trail.

## Standing deferrals carried forward (re-audited this cycle)

Re-audit basis: diff `92a8f291..HEAD` touches only the c18 fix
surfaces, plan notes, and SW stamps — no deferral surface modified;
no exit criterion fires. See the aggregate § Standing deferrals.

- DEF-R4C18-A (feed route duplication — exit: next functional feed
  edit or third feed surface) — carried (plan-308).
- DEF-R4C18-B (entitlements cascade-delete — exit: paid downloads
  enter real use) — carried (plan-308).
- DEF-R4C17-A (OG loopback fetch), DEF-R4C17-B (caption stub slice) —
  carried (plan-306).
- DEF-R4C16-A (`db/seed.ts` owner sign-off), DEF-R4C16-B (manifest
  dark splash) — carried (plan-304).
- DEF-R4C15-A (map clustering), DEF-R4C15-B (loading.tsx
  sessionStorage) — carried (plan-302).
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map fixture)
  — carried (plan-300).
- DEF-R4C11-A (aria-live constant string) — carried (plan-294).
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day) —
  carried (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/
  English — no LR change this cycle) — carried (plan-274/276/278).
- OPS-R4C6-01 (host nginx `/uploads/` — MED/High preserved) — no host
  nginx maintenance window this cycle; carried (plan-284).
- DEF-R4C8-A/B/C/D (paid GET bodies; interstitial 410; ImageZoom
  passive preventDefault; Tailwind safelist) — carried (plan-288).
- Histogram mode-cycle aria-label (incl. NOTE-R4C18-D1) — carried
  (plan-286).
- OBS-R4C12-B/C/D/E (quota-lock invariant; claim-retry guards;
  data.ts:83; ETag format) — carried (plan-296).
- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of
  those sections) — un-triggered; carried (plan-298).
