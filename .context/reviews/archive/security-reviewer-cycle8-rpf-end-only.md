# Security Reviewer — Cycle 8 RPF (end-only)

## Method

Reviewed every file in the cycle 7 / cycle 8 inventory through a
security lens (PII, token integrity, audit trail, CSRF, path traversal,
log injection).

## Findings

### HIGH

(none)

### MEDIUM

(none)

### LOW

#### C8-RPF-SEC-01 — Audit-trail gap in download route's lstat/realpath catch

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Severity: **Low** | Confidence: **High**
- **Why security:** the audit chain for paid-asset delivery must let an
  operator reconstruct **which entitlement** failed at **which step**.
  Today the lstat/realpath catch drops `entitlementId`; only the
  stream-error catch on line 206 carries it. A malicious actor who
  triggers the lstat catch (e.g., by repeatedly racing file deletes
  with a paid token redemption) leaves no per-entitlement signal that
  an operator can correlate. Current rate-limiting + token single-use
  semantics absorb the security risk; this is a Low-severity audit
  hygiene issue, not a vulnerability.
- **Fix (this cycle):** add `entitlementId: entitlement.id` to the log
  payload — same fix as C8-RPF-CR-01.

## Repo policy

The fix is non-correctness, non-data-loss, schedulable in-cycle.
