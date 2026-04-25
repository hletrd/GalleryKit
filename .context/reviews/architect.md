# Architect Review — Cycle 4 (review-plan-fix loop, 2026-04-25)

## Posture summary

- Single-instance topology preserved (Docker compose, in-process queues, advisory-lock-scoped to MySQL server).
- Storage abstraction (`@/lib/storage`) intentionally not yet wired end-to-end; documented under CLAUDE.md.
- Authentication remains multi-root admin (no role/capability split).
- Admin-server-action provenance: `requireSameOriginAdmin()` centralized; lint gates enforce wiring.
- Image processing: queue worker + per-image advisory lock + conditional UPDATE remains the correct approach for the single-writer topology.

## Findings

### C4L-ARCH-01 — Shared Unicode-formatting policy should live in one module

- **File / line:** `apps/web/src/lib/validation.ts:37`, `apps/web/src/lib/csv-escape.ts`
- **Issue:** As the project hardens more user-controlled surfaces against Trojan-Source / invisible-character spoofing, the regex/character-class is duplicated. A shared constant reduces drift risk.
- **Severity / confidence:** INFO / Medium.
- **Suggested fix:** When implementing C4L-SEC-01, factor the regex out as a named export so `isValidTopicAlias` and the new `isValidTagName` share it.

## No other architectural concerns

- No drift from documented topology.
- No new concurrency primitives needed.
- Index strategy on `images` matches query patterns.

## Confidence summary

- C4L-ARCH-01 — Medium
