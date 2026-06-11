# Run-4 Cycle 12 — security-reviewer / critic / verifier angle

Distinct full-inventory in-context pass (single-subagent constraint documented
in `_aggregate.md`). Focus: availability/DoS facets of the restore-maintenance
window, lock lifecycle, auth/session surfaces, PAT lib, middleware.

## Inventory examined
- `app/[locale]/admin/db-actions.ts` restore flow end-to-end: `LOCK_DB_RESTORE`
  acquisition (named-column read, BigInt tolerance), upload-contract lock
  layering, `beginRestoreMaintenance` early-return release paths, the inner
  try/finally, `runRestore` temp-file handling (0o600, header validation).
- `lib/upload-processing-contract-lock.ts` (exclusive GET_LOCK; null-on-failure
  contract; release idempotence via `released` flag).
- `lib/session.ts` (HMAC shape, timingSafeEqual length-guard, 24 h cap,
  hash-at-rest, prod env-secret requirement), `lib/admin-tokens.ts`
  (SHA-256-at-rest, constant-time hex compare, fail-closed on missing table,
  scope normalization), `proxy.ts` (admin route guard shape, CSP nonce flow,
  `x-gk-admin-render` marker), `lib/serve-upload.ts` (traversal/symlink
  containment, ETag conditional path), `app/actions/images.ts` upload
  validation ordering.

## FINDINGS

### COR-R4C12-01 (security facet: availability) — hung restore = unbounded admin-triggered self-DoS (HIGH / High)
Same root cause as the code-angle finding (quiesce `pause(); await onIdle()`
deadlock on a non-empty queue; see
`code-reviewer-debugger-tracer.md` for the p-queue source proof). Security
framing — what an availability reviewer must add:
- The wedge is reachable by ONE legitimate admin action with no malformed
  input: restore while ≥2 uploads are still processing. No attacker needed;
  but a malicious/compromised admin can also wedge the instance deliberately
  and silently (the request just never returns).
- While wedged: 2 of 10 pool connections are held forever by the advisory-lock
  connections; `endRestoreMaintenance()` is unreachable, so the
  process-global maintenance flag suppresses uploads, processing, and
  view-count buffering indefinitely; subsequent restores fail fast
  (`restoreInProgress`) — the documented "the lock is released automatically
  on connection close, so a crashed restore never wedges the next attempt"
  recovery property does NOT apply because the connection never closes (the
  request is hung, not crashed).
- Recovery requires a container restart — an out-of-band operator action.
NOT deferrable (correctness + availability). Scheduled for fix this cycle.

## Verified-sound surfaces (no findings)
- **Restore lock release paths** (`db-actions.ts:294-329`): all three
  early-return paths release `LOCK_DB_RESTORE` (and the contract lock where
  held); the finally releases both; `conn.release()` in the outer finally.
  The ONLY gap is the hang above (finally unreachable), not a missing release.
- **`lib/session.ts`**: prod refuses DB-secret fallback; HMAC verify is
  length-guarded `timingSafeEqual`; token age window checks both bounds
  (`tokenAge > maxAge || tokenAge < 0`); DB session row is hash-keyed;
  expired-row delete-on-read. No issue.
- **`lib/admin-tokens.ts`**: lookup by digest (plaintext never in SQL),
  re-compare constant-time, expiry enforced, scopes normalized against an
  allowlist, fail-closed when the table is missing, label truncation is
  code-point-safe. `expires_at` Date is serialized by mysql2 (no `Z` literal
  issue). No issue.
- **`proxy.ts`**: admin sub-route guard format checks are presence-only by
  design (crypto verification in actions — defense in depth documented);
  API routes excluded from matcher with the compensating `lint:api-auth`
  scanner; CSP nonce per-request. No issue.
- **`lib/serve-upload.ts`**: dir allowlist + per-segment regex + lstat symlink
  reject + realpath containment + streams from the resolved path (TOCTOU
  closed). 304 path emits no body. One nit recorded as OBS-R4C12-E below.
- **Upload quota TOCTOU (critic check on the c8 fix)**: the check→claim span
  in `uploadImages` (`images.ts:196-252`) crosses awaits (statfs, topic
  SELECT), which would be a quota-bypass race — but the EXCLUSIVE
  upload-processing-contract lock acquired at line 170 serializes entire
  upload actions on this instance AND across instances on the same MySQL
  server, so the interleaving cannot occur. Recorded as OBS-R4C12-B
  (informational invariant): if that lock is ever narrowed (made shared,
  scoped to settings-writes only, or released before the loop), the claim
  must first be made contiguous with its checks (no await between).

## Observations (not scheduled)
- **OBS-R4C12-E (LOW/Medium)** — `serve-upload.ts:209-211` compares
  `If-None-Match` member strings EXACTLY (including the `W/` prefix) instead
  of RFC 9110 §8.8.3.2 weak comparison (strip `W/` on both sides). Browsers
  echo the server's weak tag verbatim so the 304 path works everywhere today;
  only an intermediary that up/down-grades tag strength would miss the 304
  (correctness unaffected — worst case a full 200). Exit criterion: evidence
  of a real client/CDN sending a strength-modified tag, or any future ETag
  format change.
- **OBS-R4C12-B (INFO)** — see above (quota claim atomicity is lock-shielded).

## HARD-SCOPE check
No finding proposes edit/culling/scoring features. The scheduled fix restores
an existing restore-window guarantee.
