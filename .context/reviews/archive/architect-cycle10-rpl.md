# architect — cycle 10 rpl

HEAD: `0000000f3d0f7d763ad86f9ed9cc047aad7c0b1f`.

Scope: architectural/design risks, coupling, layering.

## Findings

### A10R-RPL-01 — Rate-limit module graph is getting organic [LOW / MEDIUM]

Files: `rate-limit.ts`, `auth-rate-limit.ts`.

The shape after 46+ cycles:
- `rate-limit.ts` exports generic primitives (checkRateLimit, incrementRateLimit, resetRateLimit, decrementRateLimit, pruneSearchRateLimit, ...).
- `auth-rate-limit.ts` exports auth-specific primitives (loginRateLimit entries, passwordChangeRateLimit entries, rollback* helpers).
- Each server action file has its own rate-limit helper (userCreateRateLimit in admin-users.ts, shareRateLimit in sharing.ts).

This is fine architecturally but has clear extraction points:
1. `shareRateLimit` + `userCreateRateLimit` + `passwordChangeRateLimit` share the same "bounded Map + LRU + prune" shape.
2. An `InMemoryRateLimit` class (or factory) would encapsulate this.
3. Extracting now would touch ~4 files and require careful test migration.

Not actionable this cycle. Tracked for future refactor when a fifth bucket is introduced (justifying the abstraction).

Confidence: Medium.

### A10R-RPL-02 — Action-origin and api-auth lint scanners share AST-walking infrastructure (AGG9R-RPL-15 carry-forward) [LOW / MEDIUM]

Files: `apps/web/scripts/check-action-origin.ts`, `apps/web/scripts/check-api-auth.ts`.

Unchanged from cycle 9 rpl. Fix-gated by adding a third scanner; at that point, extract a shared `scripts/lib/ts-ast.ts` module.

Confidence: Medium.

### A10R-RPL-03 — `publicSelectFields` / `adminSelectFields` derivation lives in data.ts [LOW / LOW]

File: `apps/web/src/lib/data.ts:111-201`.

Noted as a potential extraction candidate (AGG9R-RPL-18) but not actionable until the privacy policy changes in a way that makes a module split load-bearing. Current coupling is acceptable because the compile-time privacy guard at lines 197-200 catches regressions.

Confidence: Low.

### A10R-RPL-04 — `unstable_rethrow` coverage is asymmetric across server actions [LOW / MEDIUM]

Files: `apps/web/src/app/actions/*.ts`.

Only `auth.ts` uses `unstable_rethrow(e)` in its catch blocks (4 occurrences). Other action files (sharing.ts, admin-users.ts, topics.ts, tags.ts, images.ts, settings.ts) catch errors without rethrowing Next internal signals.

Current state: no production code paths INSIDE these try blocks emit NEXT_REDIRECT / NEXT_NOT_FOUND signals. So it's a future-proofing concern, not a current bug. But the inconsistency invites regressions — adding `redirect(...)` to a helper called from inside `sharing.ts`'s try block would silently fail.

Proposed: Add a lint rule — e.g. extend `scripts/check-action-origin.ts` or add `scripts/check-catch-unstable-rethrow.ts` — that flags server-action catch blocks which don't call `unstable_rethrow(e)` as the first statement. Or document the pattern in CLAUDE.md.

Confidence: Medium.

## Summary

- 0 HIGH / MEDIUM findings.
- 4 LOW findings (1 future-refactor, 2 carry-forward, 1 future-proofing).

Architecture is holding up well after 10+ cycles.
