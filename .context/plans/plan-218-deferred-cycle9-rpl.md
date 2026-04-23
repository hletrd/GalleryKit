# plan-218 — deferred cycle 9 rpl items

Generated: 2026-04-23. HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f`.

Source: `.context/reviews/_aggregate-cycle9-rpl.md`.

Per CLAUDE.md / AGENTS.md deferred-fix policy: every finding from cycle 9 rpl reviews that is NOT scheduled for this cycle's implementation is recorded below with file citation, original severity/confidence, reason for deferral, and re-open criterion. No finding has been silently dropped. No severity has been downgraded to justify deferral.

## Must-fix items (scheduled in plan-217)

- AGG9R-RPL-01 — updatePassword rate-limit ordering [MEDIUM / HIGH] — scheduled.
- AGG9R-RPL-03 — CLAUDE.md CSV doc drift [LOW / HIGH] — scheduled.

## Deferred items

### AGG9R-RPL-02 — `createAdminUser` rate-limit ordering similar issue [LOW / HIGH]
- File: `apps/web/src/app/actions/admin-users.ts:83-125`.
- Original severity/confidence: LOW / HIGH (preserved).
- Reason for deferral: action is only reachable by already-authenticated admins, so self-DoS scope is narrow. Fix class is identical to AGG9R-RPL-01, and grouping both in a single cycle risks an unplanned surface-area change to admin-user management that should have its own review window.
- Repo-rule alignment: CLAUDE.md doesn't prohibit deferring low-severity findings. Deferred work remains bound by GPG-signed conventional commits with gitmoji.
- Exit criterion: next cycle where auth-ordering consistency is the focus, OR immediately if a user reports admin-create self-DoS.

### AGG9R-RPL-04 — CLAUDE.md missing account-scoped login rate limit docs [LOW / MEDIUM]
- File: `CLAUDE.md` Authentication & Sessions section; code at `auth.ts:118-130`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: pure-docs change with no security/correctness impact. Batched with other doc updates in a future cycle.
- Exit criterion: next doc-consolidation cycle.

### AGG9R-RPL-05 — CLAUDE.md missing `gallerykit:image-processing:<id>` advisory lock docs [LOW / MEDIUM]
- File: `CLAUDE.md` Race Condition Protections section; code at `image-queue.ts:123-153`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: pure-docs change; zero code risk.
- Exit criterion: next doc-consolidation cycle.

### AGG9R-RPL-06 — `PhotoViewer` dead branches for `original_format` / `original_file_size` on public routes [LOW / HIGH]
- File: `apps/web/src/components/photo-viewer.tsx:463-475`, `apps/web/src/lib/data.ts:170-174`.
- Original severity/confidence: LOW / HIGH (preserved).
- Reason for deferral: requires a product-level decision about whether public viewers should see file-format and file-size metadata. Format+size are low-signal and arguably not PII, but changing the privacy surface should go through a deliberate review rather than getting swept up in a bug-fix cycle.
- Exit criterion: product-owner decision on public visibility of format/size fields.

### AGG9R-RPL-07 — Search dialog lacks `aria-live` result announcement [LOW / MEDIUM]
- File: `apps/web/src/components/search.tsx:207-251`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: A11y improvement, not a regression. Requires copy (translation keys) for "N results", "no results", "error". Translation review is a separate lane.
- Exit criterion: a11y-focused cycle or when adding the translation keys becomes trivial.

### AGG9R-RPL-08 — Search dialog silently swallows fetch errors [LOW / MEDIUM]
- File: `apps/web/src/components/search.tsx:56-59`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: bundled with AGG9R-RPL-07 because both require new translation keys.
- Exit criterion: same as AGG9R-RPL-07.

### AGG9R-RPL-09 — `pruneShareRateLimit` no cadence throttle [LOW / MEDIUM]
- File: `apps/web/src/app/actions/sharing.ts:36-67`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: perf micro-optimization; impact is bounded (500 entries × 20 req/min ceiling). Pattern-consistency fix is worth doing but not this cycle.
- Exit criterion: next perf-consolidation cycle, or when adding the third rate-limited action in this area.

### AGG9R-RPL-10 — `searchImages` internal length check is dead code [LOW / LOW]
- File: `apps/web/src/lib/data.ts:727`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: observational only; no exploit path. Comment or drop at convenience.
- Exit criterion: next data-layer cleanup cycle.

### AGG9R-RPL-11 — `flushGroupViewCounts` partial-failure counter semantics [LOW / MEDIUM]
- File: `apps/web/src/lib/data.ts:82-89`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: partial-failure scenario is rare and the existing exponential backoff absorbs it before the per-row retry loop reaches critical mass. Fix requires simulation testing infrastructure first.
- Exit criterion: next test-engineer cycle that builds partial-failure fixtures, or if production telemetry shows runaway flush traffic.

### AGG9R-RPL-12 — `deleteTopicAlias` dead-regex `\x00` branch [LOW / LOW]
- File: `apps/web/src/app/actions/topics.ts:446`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: dead code; no impact either way.
- Exit criterion: convenience cleanup.

### AGG9R-RPL-13 — `restoreDatabase` RELEASE_LOCK has no query timeout [LOW / MEDIUM]
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:300-314`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: pool starvation risk requires a hung RELEASE_LOCK call, which itself requires a DB-level deadlock. Current test infra doesn't simulate DB hang. Consider after DB-level test infrastructure is richer.
- Exit criterion: next DB-resilience cycle, or when the on-call logs show a hung release query.

### AGG9R-RPL-14 — `recordFailedLoginAttempt` dead export [LOW / LOW]
- File: `apps/web/src/lib/auth-rate-limit.ts:20-27`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: dead export; no impact.
- Exit criterion: convenience cleanup.

### AGG9R-RPL-15 — Lint-gate scanner AST walker duplication [LOW / MEDIUM]
- File: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: refactor-only; no correctness change. Awaits addition of a third scanner before extraction pays off.
- Exit criterion: when adding `lint:action-maintenance` (per AGG5R-12).

### AGG9R-RPL-16 — `revalidateAllAppData` overuse [LOW / MEDIUM]
- File: multiple call sites in `tags.ts`, `topics.ts`, `seo.ts`, `settings.ts`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: benchmark-gated perf work; needs before/after ISR cache measurement. Deferred in AGG5R-10 as well.
- Exit criterion: perf-focused cycle with production ISR telemetry.

### AGG9R-RPL-17 — Single-process restore-maintenance state [LOW / MEDIUM]
- File: `apps/web/src/lib/restore-maintenance.ts`.
- Original severity/confidence: LOW / MEDIUM (preserved).
- Reason for deferral: doc-only clarification. The app is explicitly single-process in the shipped Docker compose config; a horizontal-scaling user would need to redesign restore-maintenance coordination anyway.
- Exit criterion: next doc-consolidation cycle.

### AGG9R-RPL-18 — Privacy field-selection indirection extraction [LOW / LOW]
- File: `apps/web/src/lib/data.ts:111-200`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: refactor-only; current design works and is well-commented.
- Exit criterion: when the privacy policy changes in a way that makes module split load-bearing.

### AGG9R-RPL-19 — `getImages` heavy JOIN+GROUP BY is dead code [LOW / LOW]
- File: `apps/web/src/lib/data.ts:398`.
- Original severity/confidence: LOW / LOW (preserved).
- Reason for deferral: already deferred in AGG5R-07 / plan-149. Carry-forward.
- Exit criterion: deletion after next code-minimum cycle, OR keep if admin-dashboard-v2 is planned.

## Non-deferred findings previously captured but still outstanding (carry-forward)

- AGG5R-01 through AGG5R-19 — status in plan-149 unchanged.
- C46-01, C46-02 — FIXED (verified in cycle 9 rpl pass).

## Compliance notes (per CLAUDE.md / AGENTS.md)

- No security, correctness, or data-loss findings deferred in this cycle. The one MEDIUM finding (AGG9R-RPL-01) is scheduled in plan-217 for this cycle.
- All deferred items retained their original severity/confidence.
- All future implementation of deferred work will follow: GPG-signed commits, conventional-commit + gitmoji, no `--no-verify`, no force-push, target branches stay on master.
