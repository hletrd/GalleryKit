# Plan 218 — Cycle 5 RPL Deferred Findings

Generated: 2026-04-24. Source: `.context/reviews/_aggregate-cycle5-rpl.md`.

This file records review findings from cycle 5 that are deferred, per the STRICT deferral rules in the orchestrator prompt. Each entry records:
- File + line citation
- Original severity/confidence (NEVER downgraded to justify deferral)
- Concrete reason for deferral
- Exit criterion for re-opening
- Disposition of repo-policy-mandated rules (none of the deferred items are security/correctness/data-loss items that the repo rules would have required action on)

## Deferred from cycle 5 rpl

### AGG5R-07 — `getImages` vs `getImagesLite` near-dead code audit
- File: `apps/web/src/lib/data.ts:318-418`.
- Original severity/confidence: LOW / MEDIUM. Source: code-reviewer C5-03, verifier V5-F04.
- Reason for deferral: refactor audit; not a correctness/security/data-loss item. Repo rules permit deferring non-urgent refactor work to a scoped PR.
- Exit criterion: separate PR identifies all callers, makes keep/deprecate decision, lands the change.
- Repo-policy check: CLAUDE.md does not require immediate action on dead-code elimination. No override applies.

### AGG5R-09 — Lint helpers in generic `scripts/` without load-bearing banner
- File: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.
- Original severity/confidence: LOW / LOW. Source: architect A5-01.
- Reason for deferral: hygiene; no correctness/security implication (the gates themselves work).
- Exit criterion: hygiene PR adds banner comment or moves to `linters/` subtree.

### AGG5R-10 — `deleteImages` revalidation `> 20` threshold magic number
- File: `apps/web/src/app/actions/images.ts:542`.
- Original severity/confidence: LOW / LOW. Source: critic CR5-06.
- Reason for deferral: cosmetic; no behavior impact.
- Exit criterion: next docs pass.

### AGG5R-11 — Repetitive auth+origin+maintenance preamble across 20+ actions
- Files: all `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts` entry points.
- Original severity/confidence: LOW / LOW. Source: critic CR5-03.
- Reason for deferral: observational. Explicit repetition aids audit of auth-critical code paths. Extracting a HOF helper is a refactor risk that would require an independent security review. Repo rules do NOT mandate DRY-ifying auth-critical repetition; they mandate correctness and visibility.
- Exit criterion: separate RFC proposes a HOF with security review; team approves.

### AGG5R-12 — No `lint:action-maintenance` gate
- Files: (to be created).
- Original severity/confidence: LOW / MEDIUM. Source: architect A5-03, critic CR5-07.
- Reason for deferral: new gate design + ensuring no false-positives is out of scope for the single-cycle polish batch. Maintenance-message omission fails cleanly to "restore in progress" rather than a security regression. Not a correctness/security/data-loss item in the strict sense.
- Exit criterion: separate plan designs the gate; validates against current code; lands in a follow-up cycle.

### AGG5R-13 — Pool-connection `'connection'` handler bootstrap race
- File: `apps/web/src/db/index.ts:46-52`.
- Original severity/confidence: LOW / HIGH. Source: code-reviewer C5-07.
- Reason for deferral: the bootstrap window is vanishingly small (listener registered synchronously right after `createPool`; mysql2 serializes SET before SELECT on the same connection). Adding a "pre-warm" SET is defense-in-depth with no known trigger.
- Exit criterion: production monitoring detects GROUP_CONCAT truncation; add pre-warm SET at bootstrap.

### AGG5R-14 — `warnedMissingTrustProxy` lacks test reset helper
- File: `apps/web/src/lib/rate-limit.ts:29, 81-86`.
- Original severity/confidence: LOW / MEDIUM. Source: code-reviewer C5-08.
- Reason for deferral: test infrastructure opportunity; no functional bug. Related helper `resetSearchRateLimitPruneStateForTests` exists.
- Exit criterion: first test that needs to assert warn-once behavior.

### AGG5R-15 — `stripControlChars` doesn't strip Unicode format controls
- File: `apps/web/src/lib/sanitize.ts:6-9`.
- Original severity/confidence: LOW / LOW. Source: code-reviewer C5-09.
- Reason for deferral: defense-in-depth against crafted filenames; current behavior cannot cause path traversal (uploads use UUIDs). Stripping format controls would regress legitimate CJK IME input (ZWJ, etc.), so blanket stripping is wrong. Any fix is a design discussion (opt-in helper), not a bug fix.
- Exit criterion: security requirement motivates new helper OR a production bug is reported.

### AGG5R-16 — `deleteImages` ≤20 branch revalidates paths for stale/not-found IDs
- File: `apps/web/src/app/actions/images.ts:542-552`.
- Original severity/confidence: LOW / MEDIUM. Source: code-reviewer C5-11.
- Reason for deferral: minor ISR cache thrash; no correctness impact. Bounded at 20 stale IDs max.
- Exit criterion: next perf pass.

### AGG5R-17 — `getTopicBySlug` alias lookup issues two sequential SELECTs
- File: `apps/web/src/lib/data.ts:672-705`.
- Original severity/confidence: LOW / HIGH. Source: perf P5-07.
- Reason for deferral: benchmark-gated perf optimization. Only affects CJK/emoji alias requests (uncommon). React `cache()` dedupes within a single SSR request.
- Exit criterion: measured latency budget violation on alias lookup.

### AGG5R-18 — `cleanOrphanedTmpFiles` readdir failures swallowed silently
- File: `apps/web/src/lib/image-queue.ts:26-37`.
- Original severity/confidence: LOW / MEDIUM. Source: debugger D5-09.
- Reason for deferral: tiny logging improvement; no correctness impact. Cleanup is best-effort by design.
- Exit criterion: incident report traces tmp leak to this swallow.

### AGG5R-19 — `restoreDatabase` temp file leak on sync throw
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:347-365`.
- Original severity/confidence: LOW / LOW. Source: debugger D5-10.
- Reason for deferral: `containsDangerousSql` is pure regex over a sanitized string — synchronous throw is vanishingly improbable. Repo rules do not require action on edge cases with no known trigger.
- Exit criterion: reproduction case found.

## Repo-policy rule-check

Per the STRICT deferral rules:
- No deferred item is a security vulnerability that the repo's own rules require immediate action on.
- No deferred item is a correctness bug that will produce incorrect output for an expected input.
- No deferred item is a data-loss scenario.
- AGG5R-13 is marked LOW/HIGH; the HIGH confidence refers to the analysis correctness, not the severity. Severity is LOW because the bootstrap window is vanishingly small and a 1024-byte truncation would be noisy (CSV export + SEO write would both signal drift). Reviewer C5-07 explicitly marked the item observational.
- AGG5R-17 is perf, not correctness.

Nothing above contradicts repo-mandated policies (GPG signing, Conventional Commits, no `--no-verify`, no force-push to protected branches, Node 24+, etc.).

## Next steps

When a deferred item is picked up:
- Follow the exit criterion above.
- Apply repo-mandated commit rules (GPG sign with `-S`, Conventional + gitmoji, mined commit hash).
- Update this file: move the entry from "Deferred" to "Resolved" with the commit hash.
- Cross-reference the resolving plan file.
