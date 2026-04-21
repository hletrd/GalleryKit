# 185 — Cycle 7 Ultradeep Fixes

**Status:** DONE
**Date:** 2026-04-22
**Purpose:** Fix the highest-signal cycle-7 correctness/security findings in a bounded pass while preserving the ultradeep review trail.

## Scope

### U185-01 — Harden upload-serving and backup-download filesystem boundaries
**Sources:** C7-01, C7-02 in `.context/reviews/_aggregate.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/debugger.md`

1. Add realpath-backed containment checks to `serveUploadFile()` so symlinked parent directories cannot escape `public/uploads`.
2. Keep the backup download route on explicit `ENOENT -> 404`, but surface/log unexpected filesystem failures as `500` instead of masking them as missing files.
3. Add focused regression tests covering success, extension mismatch, symlink-parent traversal, unauthorized backup download, success streaming, and unexpected filesystem failures.

### U185-02 — Normalize duplicate tag query params before public filtering
**Sources:** C7-03 in `.context/reviews/_aggregate.md`, `.context/reviews/verifier.md`, `.context/reviews/tracer.md`

1. Deduplicate requested tag slugs while preserving user-specified order.
2. Keep `filterExistingTagSlugs()` unique as a defense-in-depth layer.
3. Add regression tests proving duplicate query params cannot collapse valid results to zero.

### U185-03 — Preserve dangerous-SQL detection across restore chunk boundaries
**Sources:** C7-04 in `.context/reviews/_aggregate.md`, `.context/reviews/code-reviewer.md`

1. Replace the forward-only overlap scan with a carry-over tail that survives into the next chunk.
2. Add unit coverage proving split dangerous statements are still detected when the boundary lands between `DROP` and `DATABASE`.

### U185-04 — Align nginx body-size caps with the app-side upload/restore contract
**Sources:** C7-05 in `.context/reviews/_aggregate.md`, `.context/reviews/security-reviewer.md`, `.context/reviews/document-specialist.md`

1. Reduce the server-wide nginx `client_max_body_size` to the real gallery upload allowance (2 GiB).
2. Add a tighter `/admin/db` override that matches the restore cap (250 MB).
3. Update deployment docs so proxy/body-size expectations stay aligned with app config.

### U185-05 — Backfill direct regression tests for recent public-action guardrails
**Sources:** C7-03, C7-04, R7-03 in `.context/reviews/_aggregate.md`, `.context/reviews/test-engineer.md`

1. Add direct tests for `searchImagesAction()` sanitization / rate-limit rollback behavior.
2. Keep the new tests narrow and mocked rather than introducing a wider integration harness in this cycle.

## Verification

- `npm run lint --workspace=apps/web`
- `npm test --workspace=apps/web`
- `npm run build`
- `npm run test:e2e --workspace=apps/web`
- per-cycle deploy command from `.env.deploy`

## Completion checklist

- [x] U185-01 implemented
- [x] U185-02 implemented
- [x] U185-03 implemented
- [x] U185-04 implemented
- [x] U185-05 implemented
- [x] `npm run lint --workspace=apps/web`
- [x] `npm test --workspace=apps/web`
- [x] `npm run build`
- [x] `npm run test:e2e --workspace=apps/web`
- [x] per-cycle deploy completed
