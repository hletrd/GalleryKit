# Document Specialist — Cycle 43 (2026-04-20)

## Findings

### DS43-01: CLAUDE.md version claims still potentially outdated [LOW] [MEDIUM confidence]
**File:** `CLAUDE.md`
CLAUDE.md states "Next.js 16.2" and "TypeScript 6" and "React 19". These version claims should be verified against actual `package.json` versions. Already noted as DOC-38-01/DOC-38-02 in deferred items.

### DS43-02: `db-actions.ts` `dumpDatabase` and `restoreDatabase` have no JSDoc describing the env variable security considerations [LOW] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`
The `HOME` env removal (commit 00000002b) is a security-relevant decision that should be documented in a comment near the `spawn` calls. Currently there is no comment explaining why `HOME` is excluded or why `LANG`/`LC_ALL` are included. Future maintainers might accidentally add `HOME` back or not understand the reasoning.
**Fix:** Add a comment near the env objects explaining the security rationale for each included/excluded variable.

### DS43-03: `storage/index.ts` "not yet integrated" note is accurate [INFO]
Verified that the storage backend module correctly documents its non-integrated status. No doc/code mismatch.

## Summary
1 LOW finding (missing security rationale comments in db-actions.ts spawn env). The version claims in CLAUDE.md remain deferred from prior cycles.
