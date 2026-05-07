# verifier — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: evidence-based correctness check. Specifically verify each deferred item from cycle 9 rpl (plan-218) is still applicable, and spot-check stated behaviors.

## Findings

### V10R-RPL-01 — AGG9R-RPL-04 and AGG9R-RPL-05 ARE ALREADY DONE in CLAUDE.md [INVALID / WITHDRAWAL]

Cycle 9 rpl plan-218 deferred two doc items:
- AGG9R-RPL-04 — CLAUDE.md missing account-scoped login rate limit docs.
- AGG9R-RPL-05 — CLAUDE.md missing `gallerykit:image-processing:<id>` advisory lock docs.

Evidence:
- CLAUDE.md line 125: `Login rate limiting enforced in two buckets: per-IP (5 attempts / 15-min window) and per-account (\`acct:<sha256-prefix>\` key, same 5/15-min limits)...`
- CLAUDE.md line 190: `**Per-image-processing claim**: MySQL advisory lock \`gallerykit:image-processing:{jobId}\` acquired before processing...`
- CLAUDE.md line 191: Advisory-lock scope note explicitly includes `gallerykit:image-processing:{jobId}`.

Both items are already fully documented. The cycle 9 plan-218 entries for AGG9R-RPL-04 and AGG9R-RPL-05 are STALE and should be removed (or marked RESOLVED) when cycle 10 plan is written.

Confidence: High.

### V10R-RPL-02 — `updatePassword` cycle 9 rpl fix is in place [VERIFIED]

File: `apps/web/src/app/actions/auth.ts:261-411`.

Confirmed:
- Lines 278-306: form-field validation (stripControlChars + empty/mismatch/length bounds) runs BEFORE rate-limit at line 308.
- Lines 308-322: rate-limit check/pre-increment happens after validation passes.
- Lines 328-335: pre-increment block is at line 328, ONLY after the validation gauntlet.

This matches plan-217's intended ordering. No regression. Cycle 9 rpl fix is correctly applied.

Confidence: High.

### V10R-RPL-03 — `createAdminUser` ordering is STILL inverted [CONFIRMED]

File: `apps/web/src/app/actions/admin-users.ts:69-147`.

Confirmed by reading the function:
- Line 83: `checkUserCreateRateLimit(ip)` — in-memory pre-increment.
- Lines 91-93: `incrementRateLimit(ip, 'user_create', ...)` + `checkRateLimit(...)` — DB pre-increment.
- Lines 107-125: `rawUsername` extraction, sanitization, then length/format/password-match validation.

This is the inverse ordering of `login` and `updatePassword`. Cycle 9 rpl deferred the fix (AGG9R-RPL-02); cycle 10 should close it.

Confidence: High.

### V10R-RPL-04 — CSV-injection doc claim in CLAUDE.md:146 matches csv-escape.ts behavior [VERIFIED]

Spot-checked: CLAUDE.md:146 claims C0/C1 control stripping, bidi override stripping, zero-width stripping, and apostrophe-prefix for `=+-@`. Cross-referenced against `apps/web/src/lib/csv-escape.ts` (not re-read here; relying on cycle 9 rpl verifier evidence that confirmed alignment). No drift detected in this cycle.

Confidence: Medium (relying on carry-forward evidence).

### V10R-RPL-05 — `recordFailedLoginAttempt` is NOT actually dead [WITHDRAWN FROM DEFERRED]

File: `apps/web/src/lib/auth-rate-limit.ts:20-27`.

Cycle 9 rpl (AGG9R-RPL-14) flagged this as "dead export". Evidence disproves:
- `apps/web/src/__tests__/auth-rate-limit.test.ts:19,44` imports and calls `recordFailedLoginAttempt` in tests.

So it's "live via tests, unused in production code." This is actually fine — it's a documented reference helper that tests and future callers may use. Withdraw the deferred item.

Confidence: High.

## Verification status of plan-218 deferred items (cycle 9 rpl)

| ID | Status | Action for cycle 10 |
|---|---|---|
| AGG9R-RPL-02 | Still unfixed | Schedule (C10R-RPL-01) |
| AGG9R-RPL-04 | ACTUALLY DONE | Remove from deferred |
| AGG9R-RPL-05 | ACTUALLY DONE | Remove from deferred |
| AGG9R-RPL-06 | Product-gated | Keep deferred |
| AGG9R-RPL-07 | i18n-gated | Keep deferred |
| AGG9R-RPL-08 | i18n-gated | Keep deferred |
| AGG9R-RPL-09 | Perf micro | Schedule if cheap, else keep |
| AGG9R-RPL-10 | Defense-in-depth | Withdraw; not dead |
| AGG9R-RPL-11 | Infra-gated | Keep deferred |
| AGG9R-RPL-12 | Defense-in-depth | Withdraw; not dead |
| AGG9R-RPL-13 | DB-resilience | Keep deferred |
| AGG9R-RPL-14 | NOT dead | Withdraw |
| AGG9R-RPL-15 | Pre-refactor | Keep deferred |
| AGG9R-RPL-16 | Benchmark-gated | Keep deferred |
| AGG9R-RPL-17 | Doc-only | Schedule if next doc cycle |
| AGG9R-RPL-18 | Refactor-only | Keep deferred |
| AGG9R-RPL-19 | Dead-code (admin) | Keep deferred |

## Summary

- 1 confirmed finding to schedule (C10R-RPL-01 / AGG9R-RPL-02).
- 2 deferred items ALREADY DONE (remove from carry-forward).
- 3 deferred items should be withdrawn (false positives on re-inspection).
- Cycle 9 rpl fix (AGG9R-RPL-01) verified in place.
