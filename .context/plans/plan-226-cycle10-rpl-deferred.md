# plan-226 — deferred cycle 10 rpl items

Generated: 2026-04-23. HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Source: `.context/reviews/_aggregate-cycle10-rpl.md`.

Per CLAUDE.md / AGENTS.md deferred-fix policy: every finding from cycle 10 rpl reviews that is NOT scheduled for this cycle's implementation is recorded below with file citation, original severity/confidence, reason for deferral, and re-open criterion. No finding has been silently dropped. No severity has been downgraded to justify deferral.

## Must-fix items (scheduled in plan-225)

- AGG10R-RPL-01 — `createAdminUser` rate-limit ordering [LOW / HIGH] — scheduled.

## Withdrawn (cycle 10 re-inspection)

These items from plan-218 (cycle 9 rpl deferred) have been re-classified and are NOT carried forward. Per the deferred-fix policy, withdrawing a deferred item requires documented justification:

### AGG9R-RPL-04 — WITHDRAWN: already done

- File: `CLAUDE.md` line 125.
- Original severity/confidence: LOW / MEDIUM.
- Reason for withdrawal: verifier V10R-RPL-01 and document-specialist D10R-RPL-DOC01 both confirmed that CLAUDE.md line 125 already documents the account-scoped login rate limit (`acct:<sha256-prefix>` key). The cycle 9 rpl deferral was stale; the documentation was added in a prior cycle.

### AGG9R-RPL-05 — WITHDRAWN: already done

- File: `CLAUDE.md` lines 190-191.
- Original severity/confidence: LOW / MEDIUM.
- Reason for withdrawal: verifier V10R-RPL-01 and document-specialist D10R-RPL-DOC02 both confirmed that CLAUDE.md lines 190-191 already document the `gallerykit:image-processing:{jobId}` advisory lock AND the advisory-lock scope note. The cycle 9 rpl deferral was stale.

### AGG9R-RPL-10 — WITHDRAWN: defense-in-depth by design

- File: `apps/web/src/lib/data.ts:727`.
- Original severity/confidence: LOW / LOW.
- Reason for withdrawal: code-reviewer C10R-RPL-03 re-classified this as defense-in-depth. `searchImages` is a public export that future callers may invoke directly without going through `searchImagesAction`. The 200-char check provides a cheap barrier. Keep the check; add a clarifying comment in a convenience cycle.

### AGG9R-RPL-12 — WITHDRAWN: defense-in-depth by design

- File: `apps/web/src/app/actions/topics.ts:446`.
- Original severity/confidence: LOW / LOW.
- Reason for withdrawal: security-reviewer C10R-RPL-S02 re-classified this as defense-in-depth. Even though `stripControlChars` above already removes `\x00`, including `\x00` in the post-sanitize regex is belt-and-suspenders. If `stripControlChars` were ever refactored to miss `\x00`, this regex would still catch it. Keep the regex as-is.

### AGG9R-RPL-14 — WITHDRAWN: not dead

- File: `apps/web/src/lib/auth-rate-limit.ts:20-27`.
- Original severity/confidence: LOW / LOW.
- Reason for withdrawal: verifier V10R-RPL-05 and tracer T10-3 both confirmed that `recordFailedLoginAttempt` is consumed by `apps/web/src/__tests__/auth-rate-limit.test.ts:19,44`. It is a test-supported helper that documents the "record failed login" pattern. Keep the export.

## Deferred items (unchanged from cycle 9 rpl, carry-forward)

### AGG9R-RPL-06 — `PhotoViewer` dead branches for `original_format` / `original_file_size` on public routes [LOW / HIGH]
- File: `apps/web/src/components/photo-viewer.tsx:463-475`.
- Original severity/confidence: LOW / HIGH (preserved).
- Reason for deferral: product-owner decision needed on whether public viewers should see file-format and file-size metadata.
- Repo-rule alignment: deferral is permitted for LOW-severity product-gated findings. Future implementation remains bound by GPG-signed conventional commits with gitmoji.
- Exit criterion: product-owner decision on public visibility of format/size fields.

### AGG9R-RPL-07 — Search dialog lacks `aria-live` result announcement [LOW / MEDIUM]
- File: `apps/web/src/components/search.tsx:207-251`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: requires new translation keys (English, Korean) for "N results" / "no results" / "error". Translation review is a separate lane.
- Exit criterion: a11y-focused cycle or next i18n consolidation cycle.

### AGG9R-RPL-08 — Search dialog silently swallows fetch errors [LOW / MEDIUM]
- File: `apps/web/src/components/search.tsx:56-59`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: bundled with AGG9R-RPL-07 because both require new translation keys.
- Exit criterion: same as AGG9R-RPL-07.

### AGG9R-RPL-09 — `pruneShareRateLimit` no cadence throttle [LOW / MEDIUM]
- File: `apps/web/src/app/actions/sharing.ts:36-67`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: perf micro-optimization; impact is bounded (500 entries × 20 req/min ceiling). Pattern-consistency fix is worth doing but not this cycle.
- Exit criterion: next perf-consolidation cycle, or when a third rate-limited area is introduced.

### AGG9R-RPL-11 — `flushGroupViewCounts` partial-failure counter semantics [LOW / MEDIUM]
- File: `apps/web/src/lib/data.ts:82-89`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: partial-failure scenario is rare and existing exponential backoff absorbs it before the per-row retry loop reaches critical mass. Fix requires simulation testing infrastructure first.
- Exit criterion: next test-engineer cycle that builds partial-failure fixtures, or if production telemetry shows runaway flush traffic.

### AGG9R-RPL-13 — `restoreDatabase` RELEASE_LOCK has no query timeout [LOW / MEDIUM]
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:300-314`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: pool starvation risk requires a hung RELEASE_LOCK call, which itself requires a DB-level deadlock. Current test infra doesn't simulate DB hang. Consider after DB-level test infrastructure is richer.
- Exit criterion: next DB-resilience cycle, or when on-call logs show a hung release query.

### AGG9R-RPL-15 — Lint-gate scanner AST walker duplication [LOW / MEDIUM]
- File: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: refactor-only; no correctness change. Awaits addition of a third scanner before extraction pays off.
- Exit criterion: when adding `lint:action-maintenance` (per AGG5R-12) or a third scanner.

### AGG9R-RPL-16 — `revalidateAllAppData` overuse [LOW / MEDIUM]
- File: multiple call sites in `tags.ts`, `topics.ts`, `seo.ts`, `settings.ts`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: benchmark-gated perf work; needs before/after ISR cache measurement. Deferred in AGG5R-10 as well.
- Exit criterion: perf-focused cycle with production ISR telemetry.

### AGG9R-RPL-17 — Single-process restore-maintenance state [LOW / MEDIUM]
- File: `apps/web/src/lib/restore-maintenance.ts`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: doc-only clarification. Shipped Docker compose is explicitly single-process; horizontal-scaling users would need to redesign restore-maintenance coordination anyway.
- Exit criterion: next doc-consolidation cycle.

### AGG9R-RPL-18 — Privacy field-selection indirection extraction [LOW / LOW]
- File: `apps/web/src/lib/data.ts:111-200`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: refactor-only; current design works and is well-commented. Compile-time privacy guard catches regressions.
- Exit criterion: when privacy policy changes in a way that makes module split load-bearing.

### AGG9R-RPL-19 — `getImages` heavy JOIN+GROUP BY is dead code [LOW / LOW]
- File: `apps/web/src/lib/data.ts:398`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: already deferred in AGG5R-07 / plan-149. Carry-forward.
- Exit criterion: deletion after next code-minimum cycle, OR keep if admin-dashboard-v2 is planned.

## New deferred items (cycle 10 only)

### AGG10R-RPL-02 — `sharing.ts` / other action catch blocks lack `unstable_rethrow` [LOW / MEDIUM]

- File: `apps/web/src/app/actions/sharing.ts:170,281,373`, and analogous files.
- Original severity/confidence: LOW / MEDIUM (new this cycle).
- Reason for deferral: future-proofing only. No current production code paths inside the try blocks emit NEXT_REDIRECT / NEXT_NOT_FOUND signals. Adding the rethrow is purely defensive. To avoid scope creep, this is deferred to a dedicated "action-error-propagation" cycle that can also add a lint rule (scripts/check-catch-unstable-rethrow.ts) for long-term enforcement.
- Repo-rule alignment: CLAUDE.md does not mandate rethrow in all actions. Deferral is policy-compliant.
- Exit criterion: next cycle focused on server-action error propagation, OR if a future code review turns up a redirect/notFound inside one of these try blocks.

### AGG10R-RPL-03 — `pruneShareRateLimit` cadence throttle (carry-forward duplicate of AGG9R-RPL-09)

- Duplicate; see AGG9R-RPL-09 above.

## Compliance notes (per CLAUDE.md / AGENTS.md)

- No security, correctness, or data-loss findings deferred in this cycle. The one scheduled finding (AGG10R-RPL-01) is scheduled in plan-225.
- All deferred items retained their original severity/confidence.
- Withdrawals are documented with reason (already done / defense-in-depth / used in tests).
- All future implementation of deferred work will follow: GPG-signed commits, conventional-commit + gitmoji, no `--no-verify`, no force-push, target branches stay on master.
