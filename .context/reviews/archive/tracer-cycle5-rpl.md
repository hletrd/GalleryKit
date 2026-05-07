# Tracer — Cycle 5 (RPL loop)

Generated: 2026-04-24. HEAD: `0000000789a97f7afcb515eacbe40555cee7ca8f`.

Goal: causal tracing of suspicious data flows; competing hypotheses where the behavior is ambiguous.

## Flow 1 — "an attacker submits a cross-origin mutating server action via arrow-function export"

**Hypothesis A — Framework CSRF blocks it:**
Next.js 16 server actions carry an encrypted, session-scoped action ID. Cross-origin invocation cannot forge a valid ID. Framework CSRF is the primary defense. Arrow-vs-function export doesn't matter to the framework.

**Hypothesis B — Defense-in-depth Origin/Referer check is still needed:**
The repo explicitly maintains `requireSameOriginAdmin()` as a second layer because framework CSRF could regress or be bypassed by a reverse-proxy misconfiguration. If the `lint:action-origin` gate has a blind spot, future arrow-export actions would drop this layer silently.

**Trace resolution:** both hypotheses are correct. Framework CSRF is the primary, Origin check is defense-in-depth. The gate's integrity matters because the explicit intent (captured in `scripts/check-action-origin.ts:5-11`) is "every mutating action must call requireSameOriginAdmin or be explicitly exempt." The scanner's failure to catch arrow-exports violates that intent.

→ **Trace finding T5-01:** matches C5-01 / S5-01 / V5-F01 / CR5-01.

## Flow 2 — "a malicious SQL restore dump contains CALL proc_name() to exploit a pre-existing procedure"

**Hypothesis A — MYSQL user's EXECUTE grants limit blast radius:**
The app's MySQL user should only have DML + necessary DDL on the app's database. EXECUTE on foreign procedures requires explicit grant. An attacker-crafted dump's CALL would fail unless the MySQL admin specifically granted EXECUTE.

**Hypothesis B — `--one-database` flag limits scope:**
The restore uses `mysql --one-database` which filters USE statements. But CALL to a procedure that EXISTS in another database (via `OTHER_DB.proc`) is still executable if the user has EXECUTE grant.

**Hypothesis C — A pre-existing procedure defined with SQL SECURITY DEFINER:**
If the target MySQL instance hosts another app's procedure with `DEFINER=root@%` and `SQL SECURITY DEFINER`, the CALL executes as the definer regardless of the caller's grants.

**Trace resolution:** the real risk is Hypothesis C. An admin restoring a third-party dump into a MySQL instance shared with other apps could trigger a definer procedure. The scanner's failure to block CALL is a gap for that scenario.

→ **Trace finding T5-02:** matches S5-02.

## Flow 3 — "a malicious SQL restore dump contains REVOKE to affect another app's grants"

**Hypothesis A — Restore MySQL user lacks REVOKE privilege:**
If the app's MySQL user doesn't have `GRANT OPTION`, REVOKE will fail with privilege error. Safe.

**Hypothesis B — Shared-tenant MySQL deployment with GRANT OPTION:**
Some MySQL deployments grant `ALL PRIVILEGES ON db.*` which implicitly includes `GRANT OPTION`. A REVOKE to a different user on a different DB could succeed.

**Trace resolution:** defense-in-depth blocklisting REVOKE is cheap and covers Hypothesis B.

→ **Trace finding T5-03:** matches S5-03.

## Flow 4 — "GROUP_CONCAT truncation during a connection-pool checkout race"

**Hypothesis A — The `'connection'` event listener fires before first query:**
`poolConnection.on('connection', ...)` is registered synchronously at module load. mysql2 creates lazy connections — the first query triggers creation, and the event fires before the query runs. SET completes before SELECT. No truncation.

**Hypothesis B — The event listener is async (`.query(...).catch`):**
The SET query is async. A subsequent SELECT on the same connection could theoretically be queued before SET completes. But mysql2 serializes queries on a single connection — SET runs to completion before SELECT starts.

**Hypothesis C — Pool creates the connection synchronously (pre-event-listener binding):**
If pool bootstrap creates a connection before the listener is attached, SET never runs. But `createPool` is lazy; no connections exist until first `getConnection()`, and the listener is attached immediately after `createPool`. No window.

**Trace resolution:** the existing design works correctly. The only residual risk is at bootstrap under extreme parallelism, which is vanishingly rare.

→ No new trace finding. C5-07 remains observational.

## Flow 5 — "a user concurrent-brute-force attempts login while a legitimate login resets the rate-limit bucket"

**Hypothesis A — Attacker attempt increments, legitimate reset clears, attacker's increment is lost:**
The attacker's `incrementRateLimit` runs after the legitimate user's `resetRateLimit`. The bucket is INSERTed fresh with `count = 1`. Attacker loses 1 failed-attempt credit.

**Hypothesis B — Attacker attempt runs first, legitimate user's reset clears count N:**
Both the attacker's 4 attempts and the reset happen. The reset wipes the 4 attempts. If the attacker then makes 5 more, count = 5, and they're rate-limited. Net effect: legitimate login clears attacker's accumulated pressure.

**Trace resolution:** this is a minor attacker relief but not a vulnerability. The IP-scoped reset is by design (a legitimate user proves IP ownership). An attacker sharing an IP with a legitimate user gets a small bonus. Account-scoped rate limit (per username, via `buildAccountRateLimitKey`) still limits this.

→ No new trace finding. S5-06 observational.

## Competing hypotheses summary

| Flow | Primary hypothesis | Alt hypothesis | Verdict |
|---|---|---|---|
| Arrow-export origin gap | Framework CSRF covers | Defense-in-depth gap | Both hold; gap is real for future-proofing |
| SQL CALL proc | User privilege blocks | Definer proc bypass | Alt risk is real on shared MySQL |
| SQL REVOKE | User lacks GRANT OPTION | Shared tenant exposure | Alt risk is real |
| GROUP_CONCAT bootstrap | Listener binds before use | Bootstrap race window | Primary holds; window is vanishingly small |
| Brute-force + legitimate reset | Attacker loses 1 | Accumulated attempts cleared | Minor |

## New findings from tracing

- **TR5-01** — aligns with C5-01 / S5-01 / V5-F01 / CR5-01. High cross-agent signal. Prioritize.
- **TR5-02** — aligns with S5-02. Defense-in-depth, low cost to fix.
- **TR5-03** — aligns with S5-03. Defense-in-depth, low cost to fix.

## Summary

3 trace findings, all aligning with code-reviewer/security/critic/verifier findings. No net-new tracer-only findings.
