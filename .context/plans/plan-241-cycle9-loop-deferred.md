# Plan 241 — Cycle 9 loop: deferred backlog (LOW items not implemented this cycle)

**Source:** `.context/reviews/_aggregate-cycle9-loop.md`
**Severity for all listed items:** LOW.
**Reason for deferral:** none of these are correctness, security, or
data-loss defects requiring immediate fix; they are hygiene, future-scale,
or stylistic items. Repo policy (CLAUDE.md, AGENTS.md) explicitly allows
LOW deferral with documented exit criteria. None falls under the
deferral-prohibited categories (security/correctness/data-loss).

Each entry records: file/region citation, original severity/confidence,
deferral reason, exit criterion to re-open. Severity is preserved at
its original assigned level — no downgrades.

---

### CR9-INFO-01 — OG `tagList` validation order
- **Citation:** `apps/web/src/app/api/og/route.tsx:70`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Functional correctness preserved (OG image renders
  with whatever tags pass `isValidTagName`). The order quirk only matters
  for adversarially-crafted URLs nobody constructs in practice.
- **Exit criterion:** A user reports that valid OG tags appear missing
  from a generated preview when ≥20 tags are supplied.

### CR9-INFO-02 — Sitemap fallback `console.warn` during build
- **Citation:** `apps/web/src/app/sitemap.ts:43`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Single warn line per build is acceptable and
  signal-rich for operators investigating CI logs.
- **Exit criterion:** A CI noise-reduction effort.

### CR9-INFO-03 — OG ETag does not include cache-control string
- **Citation:** `apps/web/src/app/api/og/route.tsx:75-78`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Cache-control string is a module-level constant; no
  per-request variation can drive a stale-CDN scenario.
- **Exit criterion:** Cache-control becomes per-request dynamic.

### S9-INFO-01 — OG `If-None-Match` comparison not constant-time
- **Citation:** `apps/web/src/app/api/og/route.tsx:79`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** ETag is hashed from public inputs (slug + label +
  tags + site title). Timing leaks reveal nothing secret.
- **Exit criterion:** ETag input ever includes secret state.

### S9-INFO-03 — Permissions-Policy declared in two nginx locations
- **Citation:** `apps/web/nginx/default.conf:39, 110`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Defense-in-depth. Already deferred under cycle-8
  AGG8F-14.
- **Exit criterion:** A future header-update PR fails to update one of
  the two locations.

### P9-INFO-01 — Permissions-Policy header byte cost
- **Citation:** `apps/web/next.config.ts:50`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** ~200 raw bytes per response is below any meaningful
  perf threshold. Privacy posture > byte cost.
- **Exit criterion:** None; permanent.

### CRIT9-02 — Cycle-8 25-item deferred backlog needs triage
- **Citation:** `.context/plans/plan-239-cycle8-fresh-deferred.md`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Continues from cycle 8 (AGG8F-35). Each individual
  item carries its own exit criterion. A meta-triage cycle would be
  out-of-scope for an "every-cycle" review pass.
- **Exit criterion:** Convergence check fires N consecutive cycles without
  new findings; orchestrator dedicates a cycle to backlog hygiene.

### T9-02 — OG route HTTP-level integration tests absent
- **Citation:** `apps/web/src/app/api/og/route.tsx`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Repo convention exercises route handlers via
  Playwright e2e, not vitest integration. Adding a route-level vitest
  would diverge from convention.
- **Exit criterion:** A regression in OG cache headers escapes review.

### A9-INFO-01 — Six rate-limit Maps (factory threshold = 7)
- **Citation:** `apps/web/src/lib/rate-limit.ts` plus action-file maps.
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Continues AGG8F-21 from cycle 8.
- **Exit criterion:** A 7th rate-limit Map is added.

### A9-INFO-02 — `lib/rate-limit.ts` hosts memory + DB primitives
- **Citation:** `apps/web/src/lib/rate-limit.ts`
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** File is currently 338 lines. Split threshold is
  >200 lines per section (currently in-memory ≈ 200, DB ≈ 130).
- **Exit criterion:** Either section exceeds 250 LOC.

### DS9-INFO-02 — CLAUDE.md env section is pointer-only
- **Citation:** CLAUDE.md "Environment Variables"
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** `.env.local.example` is the canonical operator
  artefact; CLAUDE.md serves as a high-level pointer.
- **Exit criterion:** A new contributor asks where the canonical env list
  is.

### DS9-INFO-03 — Env example comments could cross-link to CLAUDE.md
- **Severity/Confidence:** LOW / Low
- **Deferral reason:** Pure stylistic; not a defect.
- **Exit criterion:** A formal docs-style guide is adopted.

### DSGN9-01 — `/api/og` platform sans-serif font
- **Citation:** `apps/web/src/app/api/og/route.tsx:104`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Continues AGG8F-31. Brand-identity priority shift
  required.
- **Exit criterion:** Brand priority shifts to social previews.

### DSGN9-02 — `/api/og` topic-label cap may overflow for CJK
- **Citation:** `apps/web/src/app/api/og/route.tsx:11, 68`
- **Severity/Confidence:** LOW / Medium
- **Deferral reason:** Continues AGG8F-32. Personal gallery; admin
  controls topic labels.
- **Exit criterion:** Admin reports a CJK topic label rendering off-canvas
  in a social share.

---

## Tracking summary

- **Items deferred this cycle:** 14 (this plan)
- **Items scheduled this cycle:** 2 (plan 240)
- **Re-opens from earlier cycles:** 0
- All deferred items are LOW severity. No MEDIUM or higher items are
  deferred in this cycle.
- All security/correctness/data-loss-class items remain handled (none
  surfaced this cycle, none deferred).
