# Tracer — Cycle 25

## Review method

Causal tracing of suspicious flows, competing hypotheses analysis. Traced
authentication, upload, sharing, rate-limiting, and restore flows end-to-end.

## Traced flows (all verified correct)

1. **Login flow**: headers() -> hasTrustedSameOrigin() -> getClientIp() ->
   pre-increment (IP + account) -> DB increment -> combined check -> Argon2 verify
   -> clear counters on success / no-rollback on infrastructure error -> session
   creation in transaction -> cookie set. No gaps found.

2. **Upload flow**: getCurrentUser() -> requireSameOriginAdmin() -> upload contract
   lock -> cumulative tracker (TOCTOU-safe) -> disk space check -> topic existence
   check -> pre-increment tracker -> save original -> EXIF -> DB insert ->
   safeInsertId -> tag processing -> enqueue processing. No gaps found.

3. **Rate-limit rollback symmetry**: Login, password change, search, load-more,
   and sharing all follow the same pre-increment + rollback-on-over-limit pattern.
   Infrastructure errors do NOT roll back (auth paths). Share paths roll back on
   FK violation and no-op. All verified symmetric.

4. **Restore flow**: advisory lock -> upload contract lock -> maintenance flag ->
   flush view counts -> quiesce queue -> header validation -> SQL scan ->
   mysql restore -> resume queue -> release locks. No gaps found.

5. **Image queue**: advisory lock per job -> claim check -> process -> conditional
   UPDATE -> orphan cleanup on delete-during-process. Bootstrap cursor-based with
   permanently-failed exclusion. No gaps found.

## New Findings

None. All traced flows are correct and complete.

## Carry-forward (unchanged)

- C30-03: viewCountRetryCount re-buffer pattern (retry cap in place)
- C30-04: createGroupShareLink insertId (safeInsertId in place)
