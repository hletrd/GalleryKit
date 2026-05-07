# Document Specialist Review — Cycle 3 (RPL loop)

**Date:** 2026-04-23
**Role:** Doc/code mismatches against authoritative sources.

## Sources consulted

- `CLAUDE.md` (project-level)
- `AGENTS.md` (repo agents)
- `apps/web/README.md`
- `.context/` review artifacts (prior cycles)
- shadcn/ui documentation (for CardTitle semantics)
- next-intl docs (for locale patterns)
- Next.js 16 App Router docs (for server actions + metadata)

## Findings

### DOC3-01 — CLAUDE.md doesn't describe heading hierarchy expectations [LOW]

CLAUDE.md is comprehensive on security, testing, perf, data flow, and race conditions — but does not declare heading policy. A minimal addition (under "Security Architecture" or new "Accessibility" section): "Every page must render at least one `<h1>` at the top of the main content. `CardTitle` from shadcn is a `<div>` and should be wrapped in or replaced by an explicit heading element when it represents a page/section heading."

### DOC3-02 — apps/web/README.md could reference the admin flow [LOW] (observation)

Not a code-doc mismatch; just a scope note. The user-facing README covers setup and deployment. The admin flows are documented inline via translations. No mismatch.

### DOC3-03 — `@/lib/storage` dead-code note in CLAUDE.md is current [OK]

CLAUDE.md correctly states the storage module is internal-only and not yet wired end-to-end. Verified still accurate.

## Totals

- **0 hard mismatches**
- **2 doc enhancement opportunities** (DOC3-01, DOC3-02)
