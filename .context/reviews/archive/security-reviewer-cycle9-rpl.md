# security-reviewer — cycle 9 rpl

HEAD: `00000002ad51a67c0503f50c3f79c7b878c7e93f` (clean).

Scope: OWASP Top-10 pass over the action surface, lint gates, request-origin, session, rate-limit, db-restore, csv-escape, sql-restore-scan, upload-tracker, storage, audit, process-image.

## New findings

### C9R-RPL-S01 — `updatePassword` rate-limit counter inflated by client-side typos (blends with lockout DoS) [MEDIUM / HIGH]
- `apps/web/src/app/actions/auth.ts:297-326`.
- Same path as C9R-RPL-01 in the code-reviewer output but called out here for the security angle: a legitimate admin who fat-fingers the confirm-password ten times gets locked out of the password-change surface for 15 minutes even though no Argon2 verify ran. An adversary on the same network (egress NAT) can piggy-back on the legitimate admin's inflated counter since the bucket is IP-scoped.
- Severity: medium — self-DoS on an administrative action. Not a credential-exposure bug.
- Fix: validate form fields BEFORE the rate-limit pre-increment (mirror `login` at auth.ts:83-89).

### C9R-RPL-S02 — `sql-restore-scan` misses `/*! ... */` conditionals that disable `autocommit` + `SOURCE` hybrids [LOW / LOW]
- `apps/web/src/lib/sql-restore-scan.ts:60-62`.
- The scanner extracts inner content from `/*!VERSION ... */` conditional comments correctly. However, if an attacker crafts a file where an unversioned `/* ... */` comment (stripped by line 63) wraps text that, after stripping, reconstructs a dangerous statement near the boundary, the tail-merge buffer (64 KB) still catches it as long as the final concatenated chunk contains the matching pattern. I walked through several boundary-case chunks and could not construct a bypass; recording this as LOW-confidence observational rather than a confirmed issue.
- No fix recommended; observational.

### C9R-RPL-S03 — `deleteTopicAlias` permissive validation accepts control-stripped input that does not match original [LOW / MEDIUM]
- `apps/web/src/app/actions/topics.ts:440-448`.
- The cleanup block `if (cleanAlias !== alias) return { error }` rejects aliases containing control chars. That's correct. But `if (!cleanAlias || /[/\\\x00]/.test(cleanAlias))` re-checks for null-byte / backslash / slash on the already-cleaned value. Since `cleanAlias` has been `stripControlChars`ed, `\x00` is already removed, making the `\x00` branch unreachable. Observational only — no exploit path.
- Fix: remove `\x00` from the regex since it is dead code.

## Carry-forward confirmations

- SQL restore scanner blocks GRANT / REVOKE / RENAME USER / CREATE USER / ALTER USER / SET PASSWORD / DROP DATABASE / CREATE DATABASE / CALL / LOAD DATA / INTO OUTFILE / INTO DUMPFILE / SYSTEM / SHUTDOWN / SOURCE / TRIGGER / FUNCTION / PROCEDURE / EVENT / DELIMITER / INSTALL PLUGIN / SET GLOBAL / CREATE SERVER / RENAME TABLE / VIEW / PREPARE / EXECUTE / DEALLOCATE PREPARE / SET @var = 0x... / SET @@global. — comprehensive coverage.
- Lint gates (action-origin + api-auth) still enforce `requireSameOriginAdmin` and `withAdminAuth` respectively on every mutation / admin route.
- CSV escape strips C0/C1 + bidi overrides + zero-width + interlinear anchors + CR/LF collapse + formula-prefix quoting. Confirmed still in place.
- Session secret still refuses DB fallback in production.
- Upload tracker pre-registers entry before await to close the first-insert TOCTOU (C8R-RPL-02). Confirmed still in place.
- `limitInputPixels` applied to every Sharp constructor call. Confirmed.

## Not issues (explicit negatives)

- `process-image.ts:293-334` ICC parsing — all length reads bound-checked against `iccLen`, tagCount hard-capped at 100.
- `requireSameOriginAdmin` invoked on every mutating action per lint gate.
- `getClientIp` continues to right-most-trust the `X-Forwarded-For` chain when `TRUST_PROXY=true`, preventing attacker-spoofed left-most values.
- `timingSafeEqual` guards session signature comparison.
- `argon2id` + dummy-hash equalization on missing user prevents timing-based username enumeration at login.
