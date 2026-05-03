# Debugger Review — Cycle 8 RPF (end-only)

## Reproduction trace

If a paid customer's download fails because the original asset has
been moved/deleted between webhook delivery (entitlement minted) and
the customer following the email link, the lstat call on line 128 of
`apps/web/src/app/api/download/[imageId]/route.ts` throws ENOENT.
Line 145 returns 404 to the customer — but ENOENT is the documented
happy-failure path for "operator deleted/moved the asset", so the
catch on line 151 never fires for ENOENT.

The catch on line 151 fires for **non-ENOENT** errors: realpath EACCES
(filesystem permissions), ELOOP (symlink loop), etc. These are
operator incidents that **must be triageable by entitlementId**. Today
they cannot be: the log line is positional and the entitlementId is
omitted.

## Finding

#### C8-RPF-DBG-01 — Add `entitlementId` correlation key to download lstat/realpath catch log

- File: `apps/web/src/app/api/download/[imageId]/route.ts:151`
- Severity: **Low** | Confidence: **High**
- **Failure scenario:** customer reports "Internal Server Error" on
  paid download. Operator searches Datadog by entitlementId. The
  cycle 5/6/7 webhook + insert + refund + stream-error logs all surface
  for this entitlement. The lstat/realpath catch does not. Operator
  has no way to confirm whether the failure was at lstat (filesystem
  permissions) or stream open (race after lstat success).
- **Fix (this cycle):** convert to
  `console.error('Download lstat/realpath error', { entitlementId: entitlement.id, err })`.

## Cross-agent agreement

Same finding emerges from code-reviewer (C8-RPF-CR-01),
architect (C8-RPF-ARCH-01), tracer (C8-RPF-TR-01), critic (C8-RPF-CRIT-01).
