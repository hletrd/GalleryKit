# Plan 267 — Cycle 5 (RPF, end-only deploy) deferred items

Per the repo's deferred-fix rules in CLAUDE.md and the cycle prompt, every
review finding must be either implemented or recorded here with severity
preserved, file+line citation, concrete reason for deferral, and an exit
criterion. None of the items below are security/correctness/data-loss
findings; all are housekeeping or defense-in-depth.

## Deferred Items

### C5-RPF-D01 — Identity mapper in listEntitlements
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (PERF-01)
- **File:** `apps/web/src/app/actions/sales.ts:55-67`
- **Original severity:** Low (perf-reviewer)
- **Reason for deferral:** cosmetic; LIMIT 500 caps allocations to
  500/page-load. The mapper exists for explicit `?? null` defaults; could
  collapse if Drizzle types align. Not a defect.
- **Severity preserved:** Low.
- **Exit criterion:** when next major sales-action refactor.

### C5-RPF-D02 — Pre-validate `image.filename_original` for path separators
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (CR-05)
- **File:** `apps/web/src/app/api/download/[imageId]/route.ts:118`
- **Original severity:** Low (code-reviewer)
- **Reason for deferral:** defense-in-depth; existing
  realpath+startsWith checks at lines 121 and 141 already contain the
  threat. The lstat at line 128 is the only operation that runs against
  the unvalidated path, and the side-channel is microseconds (not
  exploitable).
- **Severity preserved:** Low.
- **Exit criterion:** when next download-route hardening pass.

### C5-RPF-D03 — Length-cap `file` query param before `isValidBackupFilename`
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (CR-06)
- **File:** `apps/web/src/app/api/admin/db/download/route.ts:19`
- **Original severity:** Low (code-reviewer)
- **Reason for deferral:** bounded by admin auth (the route is gated by
  `withAdminAuth`); `isValidBackupFilename` regex itself rejects long
  values quickly.
- **Severity preserved:** Low.
- **Exit criterion:** at next admin-route hardening pass.

### C5-RPF-D04 — Confirm dialog state-drift between `confirmTarget` and `refundingId`
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (CRIT-06, UX-01)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:127-148`
- **Original severity:** Low (critic, designer)
- **Reason for deferral:** cosmetic UX gap; AlertDialog `disabled` at
  line 298 already protects against the primary double-click case. Edge
  case is closing the dialog mid-API and opening a different row.
- **Severity preserved:** Low.
- **Exit criterion:** at next admin polish pass.

### C5-RPF-D05 — Behavior tests for `mapStripeRefundError`
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (TEST-02)
- **File:** `apps/web/src/app/actions/sales.ts:103-117`
- **Original severity:** Low (test-engineer)
- **Reason for deferral:** requires exporting the function or
  re-implementing the regex on the source. Source-contract tests cover
  the regression risk for cycle 5 fixes.
- **Severity preserved:** Low.
- **Exit criterion:** when broader behavior-test pass for sales actions.

### C5-RPF-D06 — Sales table `Recent revenue` label or pagination at >500 sales
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (DBG-03; carry-forward
  C4-RPF-D08)
- **File:** `apps/web/src/app/[locale]/admin/(protected)/sales/sales-client.tsx:170-235`
- **Original severity:** Low (debugger)
- **Reason for deferral:** not on hot path; admin-only.
- **Severity preserved:** Low.
- **Exit criterion:** when /admin/sales has >500 entitlements OR when
  D04 (sales-page mobile responsiveness) lands.

### C5-RPF-D07 — `'dl_' + 43-char base64url` shape check on token before SHA-256
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (SEC-07)
- **File:** `apps/web/src/lib/download-tokens.ts:53`
- **Original severity:** Informational (security-reviewer)
- **Reason for deferral:** bounded by SHA-256 lookup; defense-in-depth
  only. The current `startsWith('dl_')` + SHA-256 lookup is
  cryptographically equivalent — forging requires the SHA-256 universe.
- **Severity preserved:** Informational.
- **Exit criterion:** when broader download-route hardening pass.

### C5-RPF-D08 — JSDoc table mapping Stripe error type → RefundErrorCode
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (DOC-04)
- **File:** `apps/web/src/app/actions/sales.ts:103-117`
- **Original severity:** Informational (document-specialist)
- **Reason for deferral:** Implemented as inline JSDoc table in cycle 5
  (sales.ts type-comment block). Closed.
- **Status:** CLOSED in cycle 5.

### C5-RPF-D09 — `webhook` logs unbounded under signature-replay storm
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (CRIT-02)
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:216`
- **Original severity:** Low (critic)
- **Reason for deferral:** bounded by Stripe signature verification at
  line 52 which has a tolerance window (replays beyond the window are
  rejected at signature-check, never reaching the log line). Risk is low.
- **Severity preserved:** Low.
- **Exit criterion:** when first observed log-shipper saturation
  incident.

### C5-RPF-D10 — Webhook async_payment_succeeded handler missing
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (ARCH-04)
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:69`
- **Original severity:** Informational (architect)
- **Reason for deferral:** cycle 1 webhook drops async sessions
  (payment_status !== 'paid'); existing comment at lines 68-69 tracks
  the future-cycle requirement. ACH/OXXO is not enabled in production.
- **Severity preserved:** Informational.
- **Exit criterion:** when ACH/OXXO is enabled in production.

### C5-RPF-D11 — Tier-mismatch metric (instead of warn-only log)
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (ARCH-05)
- **File:** `apps/web/src/app/api/stripe/webhook/route.ts:172-179`
- **Original severity:** Informational (architect)
- **Reason for deferral:** no metrics infrastructure in repo currently.
- **Severity preserved:** Informational.
- **Exit criterion:** when metrics infra is introduced.

### C5-RPF-D12 — e2e gate not exercised this cycle [Informational]
- **Source:** `_aggregate-cycle5-rpf-end-only.md` (TEST-01 environment)
- **File:** `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- **Original severity:** Informational (test-engineer)
- **Reason for deferral:** The e2e suite spawns a local dev server and
  reads `.env.local` for DB credentials. The RPF cycle environment does
  not provide a MySQL instance or the `.env.local` file required to
  start the server. All other gates (lint, typecheck, lint:api-auth,
  lint:action-origin, vitest, build) pass cleanly.
- **Severity preserved:** Informational. NOT downgraded to fit deferral.
- **Exit criterion:** Re-open and run `npm run test:e2e` in any
  environment that provides a working `.env.local` and MySQL instance.

### Carry-forward of all cycle 1+2+3+4 deferred items
- All cycle 1, 2, 3, 4 deferred items remain deferred under cycle 5.
  Same exit criteria preserved
  (see plan-265, plan-263, plan-261, plan-258, etc.).

## Repo policy compliance

All deferrals are non-security, non-correctness, non-data-loss. None
require quoting an explicit repo carve-out. When eventually picked up,
they remain bound by:
- GPG-signed commits (`git commit -S`).
- Conventional Commits + gitmoji.
- `git pull --rebase` before push.
- No `--no-verify`.
- Required Node 24+, Next 16+, React 19+, TypeScript 6+.
