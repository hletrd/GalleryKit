# Cycle 27/100 Deferred Findings

Date: 2026-06-30 KST
Review source: `.context/reviews/_aggregate.md`
Status: deferred carry-forward

Deferral rules applied: every item below preserves original severity/confidence and cites the aggregate item. Security, correctness, and data-loss findings are scheduled in `cycle-27-2026-06-30-plan.md`; only manual-validation, operational state, approximate-analytics, or low-risk QA-process items are deferred. Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, pull-rebase before push, required gates, no force-push, no `--no-verify`, and current toolchain/package policy.

## Deferred Items

### D27-01 - Fire-and-forget analytics inserts can still cross restore boundary

- Finding/citation: `AGG-C27-10`; `apps/web/src/app/actions/public.ts:416-509`, `apps/web/src/app/[locale]/admin/db-actions.ts:491-504`, `apps/web/src/lib/data.ts:222-249`
- Original severity/confidence: Medium / Medium
- Reason for deferral: approximate public analytics are already a documented product/runtime tradeoff. `CLAUDE.md` states shared-group `view_count` is best-effort approximate and not billing/audit-grade; prior cycle 26 deferred this same boundary with a broader analytics-drain design. Not security, correctness, or data-loss for core gallery content.
- Exit criterion: reopen if row-level analytics become audit-grade, restore begins waiting on all public side effects, or analytics queue/drop-counter work is scheduled.

### D27-02 - Search/modal stacking can cause Escape/focus drift

- Finding/citation: `AGG-C27-11`; `apps/web/src/components/search.tsx:297-327`, `apps/web/src/components/lightbox.tsx:309-360`, `apps/web/src/components/info-bottom-sheet.tsx:132-139`, `apps/web/src/components/use-modal-tree-isolation.ts:19-65`, `apps/web/src/components/ui/dropdown-menu.tsx:34-50`
- Original severity/confidence: Medium / Medium
- Reason for deferral: browser behavior needs data-dependent modal-stack validation. Cycle 26 shipped base modal tree isolation; this is a more specific modal-stack/portal interaction requiring Playwright or agent-browser scenarios with live image data.
- Exit criterion: reopen when modal stack work is scheduled, when Search-over-Lightbox or dropdown-in-bottom-sheet tests are added, or if manual QA reproduces double-close/focus escape.

### D27-03 - Proxy/header trust and TLS edge assumptions must match production

- Finding/citation: `AGG-C27-R01`; `apps/web/src/lib/request-origin.ts:5-107`, `apps/web/nginx/default.conf:25-197`
- Original severity/confidence: Medium / Medium
- Reason for deferral: operational deployment validation, not a source-code defect in this repo.
- Exit criterion: reopen if deployment proxy topology changes or if `TRUST_PROXY=true` is used without proven forwarded-header overwrite at the public edge.

### D27-04 - DB restore blast radius depends on MySQL account least privilege

- Finding/citation: `AGG-C27-R02`; `apps/web/src/lib/sql-restore-scan.ts:39-221`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-678`
- Original severity/confidence: Medium / Medium
- Reason for deferral: operational grant validation. Code hardening is scheduled under P27-01.
- Exit criterion: reopen if production grants include sibling schemas/global privileges or restore scanner grammar changes.

### D27-05 - Gitignored runtime secret files were intentionally not inspected

- Finding/citation: `AGG-C27-R03`; `apps/web/src/lib/session.ts:19-35`, `README.md:134-143`, `CLAUDE.md:79-86`, `apps/web/deploy.sh:18`
- Original severity/confidence: Low / High
- Reason for deferral: secret-store inspection/rotation is operational and this cycle must not read or commit gitignored secrets.
- Exit criterion: reopen if secrets were shared in logs/tickets, copied from historical examples, or rotation work is explicitly requested.

### D27-06 - Existing host private-original modes need one-time inspection after code fix

- Finding/citation: `AGG-C27-R04`; `apps/web/scripts/migrate.js:71-110`
- Original severity/confidence: Medium if permissive modes are present / Medium
- Reason for deferral: live filesystem validation. Code-side mode normalization is scheduled under P27-03.
- Exit criterion: reopen after deploy if `data/uploads/original` contains group/world-readable files or directories.

### D27-07 - Production semantic-search/demo expectations remain operator-state-dependent

- Finding/citation: `AGG-C27-R05`; `README.md:21-42`, `CLAUDE.md:159`, `apps/web/src/app/api/search/semantic/route.ts:196-289`, `apps/web/src/app/api/search/similar/[id]/route.ts:121-125`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: host state/marketing validation, not a source defect. Repo docs already state production activation is operator-enabled and must be verified.
- Exit criterion: reopen before public release notes, demo campaigns, or semantic-search marketing changes.

### D27-08 - Nav screenshots are artifacts, not visual-regression assertions

- Finding/citation: `AGG-C27-R06`; `apps/web/e2e/nav-visual-check.spec.ts:6-78`
- Original severity/confidence: Low / Medium
- Reason for deferral: visual snapshot baselines are a QA process choice and not a correctness/security issue. P27-07 addresses the concrete nav clipping defect.
- Exit criterion: reopen when visual fidelity becomes a release gate or nav styling is redesigned.

### D27-09 - DB-backed UI/browser flows need manual validation after local DB was unavailable

- Finding/citation: `AGG-C27-R07`; DB-backed public/admin route browser validation noted in `ui-ux-designer-reviewer.md`
- Original severity/confidence: Low-Medium / Medium
- Reason for deferral: local MySQL refused `127.0.0.1:3306`; this is environment-gated manual QA, not a code finding.
- Exit criterion: reopen when a seeded local/prod-like DB is available for browser QA.

### D27-10 - Browser color/HDR support matrix can drift faster than repo tests

- Finding/citation: `AGG-C27-R08`; `CLAUDE.md:367-381`
- Original severity/confidence: Low / Medium
- Reason for deferral: external browser support validation. No current code/doc mismatch was proven.
- Exit criterion: reopen when editing color/HDR docs or browser capability code.

### D27-11 - Exact "2000+ tests" prose was not re-proven during review

- Finding/citation: `AGG-C27-R09`; `AGENTS.md:32-38`
- Original severity/confidence: Low / Medium
- Reason for deferral: wording freshness risk only; Prompt 3 still runs the full configured gate list.
- Exit criterion: reopen if exact test-count claims are used in release documentation or if full suite count drops materially.

## Scheduled Elsewhere In Cycle 27

The following findings are not deferred because they are scheduled in `cycle-27-2026-06-30-plan.md`: `AGG-C27-01`, `AGG-C27-02`, `AGG-C27-03`, `AGG-C27-04`, `AGG-C27-05`, `AGG-C27-06`, `AGG-C27-07`, `AGG-C27-08`, `AGG-C27-09`, `AGG-C27-12`, and `AGG-C27-13`.
