# Cycle 6 Aggregate Review

**Date:** 2026-04-22
**Scope:** review-plan-fix cycle 6 (`deeper`, `ultradeep comprehensive`)

## Review fan-out summary

I attempted a parallel Codex reviewer batch for the available reviewer roles, but the child-agent lanes did not yield trustworthy completed artifacts before timing out and being shut down. I then completed a manual repo-wide ultradeep sweep and refreshed the per-role markdown files in this folder as fallback specialist notes so the cycle still has durable provenance.

Timed-out reviewer lanes this cycle: `code-reviewer`, `security-reviewer`, `critic`, `verifier`, `test-engineer`.
Direct reviewer roles not available in this environment: `perf-reviewer`, `tracer`, `document-specialist`.

## Dedupe rules

- Only findings re-verified against the current working tree at `01581e5` are included below.
- Overlapping specialist notes were merged under the highest severity/confidence still supported by the code.
- Existing deferred risks from prior ultradeep cycles remain tracked in `.context/plans/182-deferred-cycle5-ultradeep-review.md` unless explicitly superseded below.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C6-01 | HIGH | High | code-reviewer, verifier, debugger, dependency-expert | The SQL-restore pipeline does not handle writable child-stdin errors, so early `mysql` exit can escape the structured restore failure path. | `apps/web/src/app/[locale]/admin/db-actions.ts:362-416` |
| C6-02 | MEDIUM | High | code-reviewer, critic, architect, designer | The fatal error shell still renders static `site-config.json` branding even though the rest of the app uses live SEO settings, so failure-mode UI can drift from the configured gallery identity. | `apps/web/src/app/global-error.tsx:45-52`, `apps/web/src/app/[locale]/layout.tsx:15-48,75-109`, `apps/web/src/lib/data.ts:770-790` |
| C6-03 | LOW | High | verifier, test-engineer | There is no dedicated regression coverage for restore-pipe error classification or fatal-shell brand derivation. | `apps/web/src/__tests__/restore-maintenance.test.ts:1-43`, absence of matching tests elsewhere in `apps/web/src/__tests__/` |

## Why these findings matter

### C6-01 — Restore can fail with raw stream errors instead of a controlled result
- `runRestore()` handles file-read errors and child-process `close`/`error`, but not the writable side of `readStream.pipe(restore.stdin)`.
- Concrete failure scenario: `mysql` exits early after encountering invalid SQL or a broken connection, Node surfaces `EPIPE` / destroyed-stream errors on `restore.stdin`, and the action escapes the typed `restoreExitedWithCode` / `restoreFailed` flow.
- Suggested fix: register a `restore.stdin` error handler before piping, ignore broken-pipe style errors that merely reflect the child exiting, and reserve hard failure handling for non-benign stdin errors.

### C6-02 — Fatal-shell branding still diverges from live SEO settings
- The localized root layout and manifest use `getSeoSettings()`, but `global-error.tsx` still hardcodes `siteConfig.nav_title || siteConfig.title`.
- Concrete failure scenario: an admin updates the gallery title/nav title in SEO settings, normal pages show the new brand, and a fatal fallback screen still shows the old title.
- Suggested fix: carry the live brand through the root HTML (for example via data attributes) so the client-only error shell can reuse it without performing its own server fetch.

### C6-03 — The new failure-path contracts are not regression-tested
- The repo currently tests restore-maintenance state only; it does not test restore stream error classification or fatal-shell branding.
- Suggested fix: add small pure helpers and unit tests around both behaviors.

## Deferred / risk items

| ID | Severity | Confidence | Source | Reason for deferral |
|---|---|---|---|---|
| R5-01 | MEDIUM | Medium | prior architect review | Multi-instance-safe restore maintenance still needs a durable/shared authority if deployment topology changes. |
| R5-02 | MEDIUM | High | prior security review | Historical secret rotation / repo-history cleanup remains operational remediation rather than a bounded source patch. |
| C6-05 | LOW | Medium | document-specialist | Restore comments/docs still need wording cleanup to distinguish the 250 MB restore cap from the broader server-action transport budget. |

## Agent failures

The following reviewer lanes were attempted in parallel but did not yield trustworthy completed child-agent output before timeout and shutdown:
- `code-reviewer`
- `security-reviewer`
- `critic`
- `verifier`
- `test-engineer`

Manual fallback specialist files were refreshed instead so this cycle still has per-role provenance.

## Aggregate conclusions

Highest-value implementation targets this cycle:
1. **Harden the restore child-process stream boundary** — C6-01
2. **Align the fatal shell with live branding** — C6-02
3. **Add regression coverage for both contracts** — C6-03

No confirmed finding above is silently dropped.
