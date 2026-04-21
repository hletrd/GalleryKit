# Cycle 4 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 4 (`deeper`, `ultradeep comprehensive`)

## Review fan-out summary

I launched a single parallel batch for the available reviewer roles (`code-reviewer`, `perf-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`, `debugger`, `document-specialist`, `designer`, `dependency-expert`) and retried the failed `perf-reviewer` / `tracer` lanes once.

The Codex subprocesses emitted partial logs but did not produce trustworthy current-cycle markdown artifacts before hanging idle; the current per-agent files are preserved as provenance, and the failed lane logs remain under `.context/reviews/logs-cycle4/`. To complete the required aggregate, I finished a repo-wide manual sweep and only kept findings I re-verified directly against the current code.

## Dedupe rules

- Only findings re-confirmed against the current repository state are included below.
- When a current issue matches a prior-cycle specialist finding and the relevant code path is still unchanged, that earlier review is listed under **Signals** as additional provenance.
- Severity/confidence reflect the strongest still-supported interpretation of the live code, not the older stale artifact wording.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C4-01 | HIGH | High | manual cycle-4 sweep; prior cycle-3 aggregate `C3-02` | Database restore still does not quiesce asynchronous writers before replaying the dump: buffered shared-group view counts can flush into restored state, and queued image-processing work can keep mutating rows/files around the restore window. | `apps/web/src/app/[locale]/admin/db-actions.ts:232-257,330-390`; `apps/web/src/lib/data.ts:9-18,43-104,596-600`; `apps/web/src/app/actions/images.ts:50-120`; `apps/web/src/lib/image-queue.ts:35-44,291-335`; `apps/web/src/instrumentation.ts:1-21` |
| C4-02 | MEDIUM | High | manual cycle-4 sweep; prior cycle-3 aggregate `C3-08` | Shared-group gallery cards still request the OG-sized WebP derivative (~1536px) for every grid tile instead of a thumbnail-sized variant. | `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:39-41,95-98,153-174` |
| C4-03 | MEDIUM | High | manual cycle-4 sweep; prior cycle-3 aggregate `C3-10` | Single and batch image deletion still swallow filesystem cleanup failures and report success, leaving operators blind to orphaned public/private files that may remain on disk. | `apps/web/src/app/actions/images.ts:361-383,463-503` |
| C4-04 | LOW | High | manual cycle-4 sweep | Rate-limit proxy warnings still fire at module-import time, so production builds / worker startups spam the same `TRUST_PROXY` warning instead of emitting it once at an actionable runtime boundary. | `apps/web/src/lib/rate-limit.ts:58-89` |
| C4-05 | LOW | High | manual cycle-4 sweep; prior cycle-3 aggregate `C3-20` | The web workspace still carries unused native/dev toolchain baggage (`better-sqlite3`, `@types/better-sqlite3`, `@vitejs/plugin-react`) plus an orphaned `playwright-test.config.ts`, which increases install/build surface and config drift without any live consumer. | `apps/web/package.json:56-74`; `apps/web/Dockerfile:1-10`; `apps/web/playwright-test.config.ts:1-22`; `apps/web/vitest.config.ts:1-13`; repo-wide search for `better-sqlite3`, `@vitejs/plugin-react`, `playwright-test.config.ts` |

## Why these findings matter

### C4-01 — Restore still mixes with background writes
- `restoreDatabase()` only serializes other restore calls via `GET_LOCK`; it does not flush buffered shared-group view counts or quiesce the image-processing queue before piping the SQL dump into `mysql`.
- `getSharedGroup()` still buffers view-count increments during normal public traffic, and `uploadImages()` can still enqueue new image-processing work while the restore action is running.
- Concrete failure scenario: an admin restores a backup while public shared-group traffic is incrementing buffered counters and the queue still has pending work. The restored DB snapshot is then immediately modified by post-snapshot view-count flushes or queue completion writes, yielding mixed state that no longer matches the dump.
- Suggested fix: add a short-lived restore-maintenance gate that flushes/pauses those async writers before restore, blocks new queue work during the restore window, and reboots the queue afterward.

### C4-02 — Shared-group grid tiles are oversized
- The page already computes an OG-sized asset for metadata, but reuses that same size inside the masonry/grid card `<Image />` source.
- Concrete failure scenario: a mobile shared-group page with many images downloads 1536px WebPs for narrow tiles, wasting transfer, decode time, and scroll responsiveness.
- Suggested fix: use a grid-sized derivative (smallest configured size, or another thumbnail target) for the card grid while keeping the large OG target only for metadata/social images.

### C4-03 — Delete success hides cleanup failures
- Both delete paths log a generic console error and still return `{ success: true }` even if variant/original cleanup throws.
- Concrete failure scenario: the database row is removed, the UI confirms success, but one or more files remain on disk and can still be served directly from `/uploads/*` until an operator discovers the orphan manually.
- Suggested fix: keep the DB delete behavior, but surface a warning/partial-cleanup result back to the admin UI and log actionable details per failed file cleanup.

### C4-04 — `TRUST_PROXY` warning is noisy instead of actionable
- The import-time `console.warn(...)` runs whenever the module is loaded in production mode, including build/static-generation worker contexts.
- Concrete failure scenario: repeated warning spam hides meaningful build/runtime diagnostics and trains operators to ignore it.
- Suggested fix: remove the import-time warning and emit the message once from a guarded runtime path (for example, on the first proxied request that would otherwise degrade to `unknown`).

### C4-05 — Dead toolchain/config surface still ships
- The repo does not reference sqlite or Vite React plugin code anywhere in the current workspace, and `npm run test:e2e` uses `playwright.config.ts`, not `playwright-test.config.ts`.
- Concrete failure scenario: contributors install/build native modules they do not need, Docker comments stay misleading, and a second Playwright config quietly drifts from the one the actual gate runs.
- Suggested fix: remove the unused dev dependencies, delete the orphaned Playwright config, and tighten any stale comments that still mention the removed toolchain.

## Agent failures

The following cycle-4 review lanes were launched but did not yield trustworthy current-cycle markdown after one retry:

- `perf-reviewer` — retry log: `.context/reviews/logs-cycle4/perf-reviewer-retry.log`
- `tracer` — retry log: `.context/reviews/logs-cycle4/tracer-retry.log`
- The remaining launched lanes emitted partial command/log output and some stale prior-cycle markdown remained in place; because the subprocesses hung idle instead of completing cleanly, I did **not** treat those outputs as authoritative cycle-4 reviews. Their logs are preserved under `.context/reviews/logs-cycle4/`.

## Aggregate conclusions

Highest-value implementation targets this cycle:
1. **Restore writer quiescence** — C4-01
2. **Shared-group thumbnail sizing** — C4-02
3. **Deletion cleanup visibility** — C4-03
4. **Operational log/toolchain cleanup** — C4-04, C4-05

No confirmed finding above was silently dropped.
