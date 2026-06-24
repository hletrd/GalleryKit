# Cycle 2 Deep Review — Document Specialist

Date: 2026-06-24
HEAD: 95de4d11

## Summary

Cycle 1 README fixes (AGG-13, AGG-17) were well-executed. No new doc/code mismatches found.

## New Findings (Cycle 2)

### DOC2-01 — `apps/web/README.md` still references `--production` backfill without `--force`

- Severity: Low
- Confidence: High
- Type: Documentation mismatch

Evidence: `apps/web/README.md` documents the backfill command with `--production` but `scripts/backfill-clip-embeddings.ts` requires `--force` to run before production is activated (AGG-15).

Failure scenario: Operator follows README, runs command, gets no-op, thinks backfill is broken.

Suggested fix: Add `--force` to the documented command or clarify the activation sequence.

### DOC2-02 — `.env.local.example` still missing `SEMANTIC_SEARCH_ALLOW_PRODUCTION` and `CLIP_MODELS_ROOT`

- Severity: Low
- Confidence: High
- Type: Documentation gap

Evidence: Despite AGG-16 being identified in cycle 1, the `.env.local.example` file still doesn't include these production semantic search env vars. Commit 2191a6bc added some env vars but not the semantic search ones.

Failure scenario: Operators don't know these env vars exist for production semantic search.

Suggested fix: Add commented examples with clear warnings about production-only usage.

## Verified Fixed (from Cycle 1)

- AGG-13: README now says semantic search is operator-enabled — verified
- AGG-17: README notes disabled-by-default — verified
- AGG-39: i18n key added for retry error — verified in messages

## Remaining Open (from Cycle 1)

- AGG-15: Backfill command docs mismatch — still present
- AGG-16: Missing env examples — partially fixed (2191a6bc added some but not semantic search)
- AGG-40: HDR claims — still present in README
- AGG-41: Performance claim — still present in README
- AGG-42: Demo config leaks — still present
- AGG-43: GitHub trust signal — still present
