# Plan 220 — Cycle 6 RPL Deferred Findings

Generated: 2026-04-23. Source: `.context/reviews/_aggregate-cycle6-rpl.md`.

This file records review findings from cycle 6 rpl that are deferred, per
the STRICT deferral rules in the orchestrator prompt. Each entry records:
- File + line citation (where applicable).
- Original severity/confidence (NEVER downgraded to justify deferral).
- Concrete reason for deferral.
- Exit criterion for re-opening.
- Disposition of repo-policy-mandated rules (none of the deferred items
  are security/correctness/data-loss items that repo rules would require
  immediate action on).

## Deferred from cycle 6 rpl

### AGG6R-08 — `runRestore` 7x duplicated `fs.unlink(tempPath).catch(() => {})` calls
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:308-449`.
- Severity/Confidence: LOW / HIGH. Source: critic CR6-10.
- Reason for deferral: refactor. Correctness is already preserved — every
  known error path unlinks the temp file. The 7x duplication is a
  maintainability concern, not a bug. Wrapping in try/finally touches the
  restore pipeline (security-critical); extracting safely requires care
  to preserve the existing ordering (unlink BEFORE resolve in error
  branches). Separate PR + review.
- Exit criterion: a scoped refactor PR with independent review.
- Repo-policy check: CLAUDE.md does not require immediate action on pure-
  refactor. No override applies.

### AGG6R-12 — `saveOriginalAndGetMetadata` height fallback to `width`
- File: `apps/web/src/lib/process-image.ts:273-274, 347-348`.
- Severity/Confidence: LOW / HIGH. Source: debugger D6-01.
- Reason for deferral: defensive improvement. A corrupted image with
  partial Sharp metadata (width present, height missing) would render
  with wrong aspect ratio. No known incident; no active regression.
  Changing the fallback to throw could fail-closed for images Sharp can
  technically process — tradeoff requires data gathering.
- Exit criterion: a user report or test fixture showing a tall/wide
  image rendering as square.

### AGG6R-13 — `cleanOrphanedTmpFiles` race with in-flight atomic rename
- File: `apps/web/src/lib/image-queue.ts:23-37`.
- Severity/Confidence: LOW / MEDIUM. Source: debugger D6-04.
- Reason for deferral: defensive improvement. The race would only trigger
  if bootstrap coincidentally fires during an atomic rename (very narrow
  window, retry path exists). No incident.
- Exit criterion: reproducible race or production incident.

### AGG6R-14 — `viewCountBuffer` dropped-increment log discloses groupId
- File: `apps/web/src/lib/data.ts:34, 73`.
- Severity/Confidence: LOW / LOW. Source: security S6-08.
- Reason for deferral: information disclosure is theoretical. Shared-group
  IDs are sequential integers and not especially sensitive; public shares
  use `key` (base56) not `id`. Redacting the ID would hurt diagnosability.
- Exit criterion: security requirement that internal IDs must never log.

### AGG6R-15 — No test for `viewCountBuffer` backoff
- File: `apps/web/src/lib/data.ts:18-96`.
- Severity/Confidence: LOW / HIGH. Source: test-engineer T6-02.
- Reason for deferral: test-infra improvement. The backoff logic is
  mechanically simple and unlikely to regress without the whole file
  being refactored. AGG5R-15 carry-forward covers adjacent test-infra.
- Exit criterion: the view-count buffer is refactored OR a regression
  occurs.

### AGG6R-16 — No direct `escapeCsvField` unit test
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:27-41`.
- Severity/Confidence: LOW / HIGH. Source: test-engineer T6-05.
- Reason for deferral: step 6 of plan-219 adds `csv-escape.test.ts`
  alongside the CRLF-collapse fix. This deferred note is about a
  standalone test even if the fix doesn't land — but plan-219 addresses
  it. Effectively resolved by plan-219 step 6. Marking "partial" — if
  plan-219 step 6 doesn't land this cycle, this remains deferred.

### AGG6R-17 — No rate limit on `exportImagesCsv`
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:43-110`.
- Severity/Confidence: LOW / MEDIUM. Source: security S6-03.
- Reason for deferral: defense-in-depth. Only authenticated admins
  trigger this; there is no direct attack without session compromise.
  Adding a rate limit creates a new UX friction for legitimate admin
  exports. Separate design discussion.
- Exit criterion: incident report of a compromised admin session
  exfiltrating via CSV.

### AGG6R-18 — `restoreDatabase` literal `BigInt(1)` per lock check
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:278`.
- Severity/Confidence: LOW / HIGH. Source: code-reviewer C6-11.
- Reason for deferral: cosmetic. Readability improvement with negligible
  perf benefit (BigInt(1) is a fast literal).
- Exit criterion: next cosmetic docs pass.

### AGG6R-19 — `scanFd.read` bytesRead not checked in restore scanner
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:353`.
- Severity/Confidence: LOW / MEDIUM. Source: debugger D6-07.
- Reason for deferral: trailing zero bytes are benign — the scanner's
  pattern matches (e.g., `\bGRANT\s/i`) don't match on zero-padding.
  Worst case is a slightly larger scanned string. No correctness or
  security implication.
- Exit criterion: scanner pattern addition that becomes sensitive to
  trailing nulls.

### AGG6R-20 — `viewCountBuffer` FIFO eviction + dropped-increment monitoring
- File: `apps/web/src/lib/data.ts:12-96`.
- Severity/Confidence: LOW / MEDIUM. Source: code-reviewer C6-02, C6-08.
- Reason for deferral: observational. FIFO eviction is acceptable for
  the use case (admin-created shared groups with bounded key count).
  Adding a monitoring counter is feature work, not a fix.
- Exit criterion: observability feature design.

### AGG6R-21 — Search bar "keep typing" hint for queries below 2 chars
- File: `apps/web/src/components/search.tsx`.
- Severity/Confidence: LOW / MEDIUM. Source: designer DE6-01.
- Reason for deferral: UX polish. Current behavior is silent — works but
  gives no feedback. Non-critical.
- Exit criterion: UX design pass.

## Repo-policy rule-check

Per the STRICT deferral rules:
- No deferred item is a security vulnerability that the repo's own rules
  require immediate action on.
- No deferred item is a correctness bug that produces incorrect output
  for expected input.
- No deferred item is a data-loss scenario.

Specifically:
- **AGG6R-12** (height fallback) is a minor rendering regression only for
  corrupted images — Sharp rejects most malformed inputs before reaching
  this fallback.
- **AGG6R-13** (cleanOrphanedTmpFiles race) has a retry path and no
  known trigger.
- **AGG6R-17** (CSV export rate limit) gates on admin auth, which is the
  repo's primary access control; adding a rate limit is defense-in-depth
  only.
- **AGG6R-19** (bytesRead) has no triggering attack vector; zero-padding
  doesn't bypass any dangerous-SQL pattern.

Nothing above contradicts repo-mandated policies (GPG signing,
Conventional Commits, no `--no-verify`, no force-push, Node 24+, etc.).

## Cycle-5-rpl carry-forward (status unchanged)

All cycle-5-rpl deferred items in `plan/plan-218-cycle5-rpl-deferred.md`
remain deferred with original severity/confidence. Cross-reference:
- AGG5R-07 — `getImages` vs `getImagesLite` near-dead audit.
- AGG5R-09 — lint helper `scripts/` banner. RESOLVED by plan-219 step 1.
- AGG5R-10 — `deleteImages` > 20 threshold magic number.
- AGG5R-11 — repetitive auth preamble.
- AGG5R-12 — `lint:action-maintenance` gate.
- AGG5R-13 — pool-connection 'connection' handler bootstrap race.
- AGG5R-14 — `warnedMissingTrustProxy` test reset helper.
- AGG5R-15 — `stripControlChars` Unicode format controls.
- AGG5R-16 — `deleteImages` ≤20 branch revalidates stale IDs.
- AGG5R-17 — `getTopicBySlug` alias lookup double SELECT.
- AGG5R-18 — `cleanOrphanedTmpFiles` readdir error logging. RESOLVED
  by plan-219 step 4 (log-after-unlink).
- AGG5R-19 — `restoreDatabase` temp file leak on sync throw.

## Older backlog carry-forward

Per `.context/reviews/_aggregate-cycle5-rpl.md` "Carry-forward" section,
all prior cycles' deferred items remain deferred with original
severity/confidence.

## Next steps

When a deferred item is picked up:
- Follow the exit criterion above.
- Apply repo-mandated commit rules (GPG sign with `-S`, Conventional +
  gitmoji, mined commit hash).
- Update this file: move entry from "Deferred" to "Resolved" with commit
  hash.
- Cross-reference the resolving plan file.
