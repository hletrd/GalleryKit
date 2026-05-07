# Document Specialist — Cycle 14 (current run)

**Reviewer:** document-specialist (doc/code mismatches against authoritative sources)
**Scope:** CLAUDE.md, AGENTS.md, README.md, plan/**, .context/**, source-of-truth code.

## Methodology

Cross-referenced every claim in CLAUDE.md against the current code:
- Tech stack version statements (Next.js 16.2, React 19, TypeScript 6, Sharp).
- Endpoint inventory (`/api/live`, `/api/health`).
- Image upload flow + race condition protections list.
- Security architecture claims.
- Permanently deferred items.

Re-walked previously-deferred doc gaps (C32-04 health endpoint disclosure, font subsetting, docker node_modules removal) — all documented as intentional.

## Findings

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| (none) | Documentation matches code. No drift. | — | — | — |

### Re-checks

- **CLAUDE.md "Storage Backend (Not Yet Integrated)" disclaimer.** Matches `apps/web/src/lib/storage/index.ts` header comment.
- **CLAUDE.md "ICC profile parsing bounds-checked".** Matches `apps/web/src/lib/process-image.ts:291-334`.
- **CLAUDE.md "Argon2 timing-safe user enumeration: Dummy hash for non-existent users".** Matches `apps/web/src/app/actions/auth.ts:62-68, 157`.
- **CLAUDE.md "CSV export escapes formula injection characters".** Matches `apps/web/src/lib/csv-escape.ts:33-53`.
- **CLAUDE.md "Reverse proxy body caps aligned: nginx config uses 2 GiB / 250 MB for /admin/db".** Matches `apps/web/nginx/default.conf:16, 58`.
- **CLAUDE.md "Docker liveness should probe /api/live; /api/health is DB-aware".** Cross-checked the API route inventory.
- **CLAUDE.md GIT WORKFLOW (gitmoji + GPG sign + 7-leading-hex-zero mining).** Aligned with the commit log — every recent commit shows the `0000000` prefix and gitmoji.

## Verdict

Documentation is current. No mismatches to file.
