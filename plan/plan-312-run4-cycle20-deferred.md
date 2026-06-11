# Plan 312 — Run-4 Cycle 20 deferred ledger

**Source review:** `.context/reviews/run4-cycle20/_aggregate.md`
**Status:** RECORDED (re-audit only — no NEW deferrals this cycle)

Repo-rule basis for deferral: CLAUDE.md permits deferral for
non-security / non-correctness / non-data-loss items when a concrete exit
criterion is recorded (established ledger convention plan-274 → plan-310).

## No new deferrals this cycle

Both cycle-20 findings are SCHEDULED, not deferred:
- **SEC-R4C20-01** (OG URL backslash bypass) — a security-control
  correctness defect; NOT deferrable per repo rules; fixed in plan-311.
- **TEST-R4C20-02** (missing backslash test case) — fixed alongside
  SEC-R4C20-01 in plan-311.
- **DES-R4C20-01** — adjudication only (root cause = SEC-R4C20-01); no
  separate work item.

## Standing deferrals carried forward (re-audited this cycle)

Re-audit basis: diff `625898fd..HEAD` touches only the c19 fix surfaces,
plan notes, the c19 deploy record, and SW stamps — no deferral surface
modified; no exit criterion fires. See the aggregate § Standing
deferrals re-audit.

- OBS-R4C19-A (seed-admin.ts `$$argon2` compose-escape normalization —
  exit: first bootstrap-login support report with a compose-escaped hash,
  OR next functional seed-admin edit) — un-triggered; carried (plan-310).
- DEF-R4C19-B (no canonical `extractRows<T>()` raw-row seam — exit: next
  NEW raw `db.execute` consumer introduces the helper) — un-triggered (no
  new raw `db.execute` consumer this cycle); carried (plan-310).
- DEF-R4C18-A (feed route duplication — exit: next functional feed edit or
  third feed surface) — carried (plan-308).
- DEF-R4C18-B (entitlements cascade-delete — exit: paid downloads enter
  real use) — carried (plan-308).
- DEF-R4C17-A (OG loopback fetch), DEF-R4C17-B (caption stub slice) —
  carried (plan-306).
- DEF-R4C16-A (`db/seed.ts` owner sign-off), DEF-R4C16-B (manifest dark
  splash) — carried (plan-304).
- DEF-R4C15-A (map clustering), DEF-R4C15-B (loading.tsx sessionStorage) —
  carried (plan-302).
- RISK-R4C14-03 + TEST-R4C14-02 (iOS 17+ dimg-only gain-map fixture) —
  carried (plan-300).
- DEF-R4C11-A (aria-live constant string) — carried (plan-294).
- DEF-R4C10-A/B (gps-strip extension trust; OnThisDay server day) —
  carried (plan-292).
- DEF-R4C1-01 / DEF-R4C2-01 / DEF-R4C3-01 (LR PAT breadth/scopes/English —
  no LR change this cycle) — carried (plan-274/276/278).
- OPS-R4C6-01 (host nginx `/uploads/` — MED/High preserved) — no host
  nginx maintenance window this cycle; carried (plan-284).
- DEF-R4C8-A/B/C/D (paid GET bodies; interstitial 410; ImageZoom passive
  preventDefault; Tailwind safelist) — carried (plan-288).
- Histogram mode-cycle aria-label (incl. NOTE-R4C18-D1) — carried
  (plan-286).
- OBS-R4C12-B/C/D/E (quota-lock invariant; claim-retry guards; data.ts:83;
  ETag format) — carried (plan-296).
- DOC-R4C13-01/02 (CLAUDE.md section refreshes gated on next edit of those
  sections) — un-triggered; carried (plan-298).
- OBS-R4C19-B (check-api-auth.ts:162 bare `require.main`), OBS-R4C19-D
  (migrate-capture-date.js trailing `Z`) — dormant; align opportunistically
  on next functional edit; carried (plan-310 Recorded decisions).
