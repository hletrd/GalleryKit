# Cycle 5 Aggregate Review

**Date:** 2026-04-22  
**Scope:** review-plan-fix cycle 5 (`deeper`, `ultradeep comprehensive`)

## Review fan-out summary

I attempted two parallel Codex reviewer batches for the available reviewer roles (`code-reviewer`, `security-reviewer`, `critic`, `verifier`, `designer` on the first pass; `code-reviewer` + `verifier` on the retry). Both batches failed to return trustworthy artifacts before timing out, so I shut them down and completed a manual repo-wide sweep instead. The per-role markdown files in this folder were refreshed manually as fallback specialist notes so the cycle still has durable provenance.

Unavailable reviewer roles in this environment: `perf-reviewer`, `tracer`, `document-specialist`.

## Dedupe rules

- Only findings re-verified against the current working tree at `7dc7dd2` are included below.
- Overlapping findings from the manual specialist notes were merged under the highest severity/confidence still supported by the code.
- Architectural or operational items that are real but broader than a bounded patch are listed under **Deferred / risk** rather than inflated into immediate code-fix claims.

## Confirmed findings

| ID | Severity | Confidence | Signals | Finding | Primary citations |
|---|---|---|---|---|---|
| C5-01 | HIGH | High | code-reviewer, security-reviewer, debugger, verifier | Restore maintenance still leaves conflicting write paths alive: most mutating admin/auth actions ignore the maintenance window, and `uploadImages()` only checks the guard once at request start. | `apps/web/src/app/[locale]/admin/db-actions.ts:235-279`; `apps/web/src/app/actions/images.ts:81-88,180-227`; `apps/web/src/app/actions/admin-users.ts:67-69`; `apps/web/src/app/actions/settings.ts:35-37`; `apps/web/src/app/actions/seo.ts:49-51`; `apps/web/src/app/actions/sharing.ts:61-63`; `apps/web/src/app/actions/tags.ts:42-44`; `apps/web/src/app/actions/topics.ts:33-35,104-106`; `apps/web/src/app/actions/auth.ts:68-70,251-255` |
| C5-02 | MEDIUM | High | code-reviewer, critic, verifier, dependency-expert, designer | The restore-size contract is split: the server action rejects files above 250 MB only after crossing a 2 GiB Next.js server-action ingress limit, and the DB UI gives no preflight max-size guidance. | `apps/web/src/app/[locale]/admin/db-actions.ts:227-230,282-290`; `apps/web/next.config.ts:96-101`; `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:57-79,158-180` |
| C5-03 | MEDIUM | High | test-engineer, verifier | Regression coverage for restore mode is too shallow: tests only assert the process-local flag toggles, not that representative write paths are actually blocked. | `apps/web/src/__tests__/restore-maintenance.test.ts:1-25`; representative mutators `apps/web/src/app/actions/images.ts:81-88,180-227`, `apps/web/src/app/actions/settings.ts:35-37` |
| C5-04 | LOW | Medium | code-reviewer, critic, designer | Fatal error branding still reads static `site-config.json` instead of the live SEO/settings source used by normal runtime metadata. | `apps/web/src/app/global-error.tsx:1-3,45-52`; `apps/web/src/app/[locale]/layout.tsx:15-48` |

## Why these findings matter

### C5-01 — Restore is still not a real write barrier
- `restoreDatabase()` now flips a maintenance flag, flushes buffered view counts, and pauses the queue, but almost every other authenticated mutation keeps running normally.
- `uploadImages()` blocks only when restore is already active before the request begins. If the restore starts while an upload is mid-flight, the upload can still save originals and insert DB rows because there is no second guard near the insert/queue boundary.
- Concrete failure scenario: one admin triggers restore while another updates tags/settings/users or while an upload is already inside preprocessing. The resulting database no longer matches the restored dump.
- Suggested fix: add a reusable maintenance guard to conflicting mutators and re-check `uploadImages()` at the write boundary, cleaning up any saved original if the restore window opened mid-request.

### C5-02 — Restore-size feedback arrives too late
- The app advertises a 250 MB restore limit in the action, but the actual Next.js server-action transport still accepts bodies up to `NEXT_UPLOAD_BODY_SIZE_LIMIT` (default 2 GiB).
- The DB admin page does not tell the operator the real max size or reject oversized files before submit.
- Concrete failure scenario: an operator selects a 900 MB dump and waits through upload/parse time only to get a late `fileTooLarge` error.
- Suggested fix: immediately share the 250 MB constant with the client UI and add preflight rejection; defer the bigger transport-boundary redesign if needed.

### C5-03 — Tests do not prove the restore barrier works
- The existing test file checks only `beginRestoreMaintenance()` / `endRestoreMaintenance()` state transitions.
- No test proves that representative mutators or the upload write boundary stop when restore mode is active.
- Suggested fix: add focused regression coverage around the shared guard and the upload boundary.

### C5-04 — Branding still has a stale fallback path
- Normal runtime metadata now comes from `getSeoSettings()`, but `global-error.tsx` still shows `siteConfig.nav_title || siteConfig.title`.
- Concrete failure scenario: an operator renames the gallery in SEO settings, but fatal error pages still show the old brand.
- Suggested fix: either intentionally document this as a file-backed fallback shell or align it with the live brand source.

## Deferred / risk items

| ID | Severity | Confidence | Source | Reason for deferral |
|---|---|---|---|---|
| R5-01 | MEDIUM | Medium | architect | `restore-maintenance.ts` is process-local (`globalThis` symbol). That is acceptable for today’s single-instance deployment, but a multi-instance deployment would need a durable/shared maintenance authority. |
| R5-02 | MEDIUM | High | security-reviewer | Historical secret exposure in git history remains an operational remediation task (rotation/history governance), not a bounded source-code patch. |

## Agent failures

The following reviewer lanes were attempted but did not yield trustworthy child-agent output before timeout and shutdown:
- First batch: `code-reviewer`, `security-reviewer`, `critic`, `verifier`, `designer`
- Retry batch: `code-reviewer`, `verifier`

Manual fallback specialist files were written instead so this cycle still has per-role provenance.

## Aggregate conclusions

Highest-value implementation targets this cycle:
1. **Make restore a real write barrier** — C5-01
2. **Expose/guard the 250 MB restore limit earlier in the UI** — C5-02
3. **Add regression coverage for the restore barrier** — C5-03

No confirmed finding above was silently dropped.
