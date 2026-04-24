# debugger — cycle 1 (new)

Scope: latent bug surface, failure modes, regressions.

## Findings

### DBG1-01 — Password-change flow loses rate-limit pressure on transaction failure
- **Citation:** `apps/web/src/app/actions/auth.ts:337-371`
- **Severity / confidence:** MEDIUM / HIGH
- **Failure mode:** `clearSuccessfulPasswordAttempts(ip)` executes after `argon2.verify()` but before the transactional `UPDATE admin_users` + session purge. If that transaction throws, only a single decrement rollback runs. Any prior failed attempts in the same window are irrecoverably cleared.
- **Reproduction:** 4× failed attempts → 1 correct-current-password attempt with a forced DB failure (e.g. simulated connection drop during the transaction). Expected counter: 4 + rollback on failure → ~4 (pressure preserved). Actual counter: 0 (cleared) then decrement to -1 (or clamped to 0). Attacker can resume up to 5 attempts.
- **Fix:** Move the clear to after the transaction commits.

### DBG1-02 — Flipping provenance default without test edit could be reverted by a future PR
- **Citation:** `apps/web/src/__tests__/request-origin.test.ts:94-106`
- **Severity / confidence:** LOW / HIGH
- **Failure mode:** A future well-meaning PR touches `request-origin.ts`, trips the compat test expecting `true`, and "fixes" it by flipping the default back to loose. Without a dedicated strict-default test, this regression is silent.
- **Fix:** Tie the default flip to a test edit that locks the stricter expectation in the same commit.

### DBG1-03 — `useState(editTitle)` rehydration after save leaves stale client state
- **Citation:** `apps/web/src/components/image-manager.tsx:232-233`
- **Severity / confidence:** LOW / HIGH
- **Failure mode:** User pastes a title with a non-breaking whitespace prefix. Server trims and stores the trimmed value. Client state stores the pre-trim value until `router.refresh()`. On next manual save without re-opening the dialog, the client sends the trimmed string back (idempotent) — but the on-screen editing dialog briefly shows "saved" with the wrong trailing whitespace.
- **Fix:** Use the server-returned normalized value.

### DBG1-04 — `/admin` login page enumerates admin routes in HTML
- **Citation:** `components/admin-header.tsx:9-30`; `components/admin-nav.tsx:15-45`
- **Severity / confidence:** LOW / HIGH
- **Failure mode:** Not a security bypass, but the login-page HTML includes every `/admin/*` href. Bots scanning the login page can discover the admin surface without credentials. Fix is the same layout branch as CR1F-03.

### DBG1-05 — Seed scripts / dev data drift
- **Citation:** `apps/web/scripts/seed-e2e.ts`, `apps/web/src/db/seed.ts`
- **Severity / confidence:** LOW / HIGH
- **Failure mode:** Divergent invariants cause flaky or silently-skipped tests, and uppercase slugs cannot be edited/renamed through the admin UI without breaking the slug contract.

### DBG1-06 — Overall: no new crash bugs on current HEAD beyond the items listed
- **Disposition:** Checked image queue/process-image claim-and-update race; still correct (see `image-queue.ts` conditional UPDATE + orphan cleanup).
