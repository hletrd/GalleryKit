# Plan 281 — Run-4 Cycle 5 fixes

**Source review:** `.context/reviews/run4-cycle5/_aggregate.md` (8 findings:
6 fix items, 2 test gaps folded into their parent fixes, 0 new deferrals).
Per-angle provenance in the same directory. Repo policy: GPG-signed commits,
Conventional Commits + gitmoji, per-iteration push, per-cycle deploy, no
suppressions. HARD-SCOPE: no edit/culling/scoring features.

## Task 1 — COR-R4C5-01 + TEST-R4C5-06: smart-collection cursor pagination (duplicate-page loop + boundary data loss)
**Files:** `apps/web/src/lib/data.ts` (`getImagesForSmartCollection`),
`apps/web/src/app/actions/public.ts` (`loadMoreSmartCollectionImages`),
new `apps/web/src/__tests__/smart-collection-pagination.test.ts`
- [ ] `getImagesForSmartCollection(compiledCondition, pageSize, offsetOrCursor)`:
      accept `number | ImageListCursorInput` for the third arg; normalize via
      `normalizeImageListCursor`; on cursor → add `buildCursorCondition(cursor)`
      to the WHERE (same ORDER BY triple, predicate provably order-compatible)
      and skip `.offset()`; numeric path unchanged. Keep the helper's internal
      single +1 lookahead + `normalizePaginatedRows`.
- [ ] `loadMoreSmartCollectionImages`: mirror `loadMoreImages`'s input
      handling — `normalizeImageListCursor` first; unparseable object cursor →
      `{ status: 'invalid' }`; pass `safeLimit` (NOT `safeLimit + 1`); return
      the helper's rows + hasMore directly (no re-slice).
- [ ] Client (`load-more.tsx` / `home-client.tsx`) needs NO change once the
      action consumes cursors — verify the cursor it already sends matches
      `ImageListCursorInput` (it does: id / capture_date / created_at).
- [ ] Tests (TEST-R4C5-06): action-level behavioral cases with mocked data
      layer + `next/headers` (cursor object → normalized cursor reaches the
      helper, NOT offset 0; invalid object → 'invalid'; numeric offset
      preserved; private/unknown slug rollback intact); helper-level
      boundary case (exactly limit+1 remaining → hasMore true, no dropped
      row); source-contract guard that the action passes `safeLimit`.

## Task 2 — SEC-R4C5-02: remove the dead unauthenticated `getSmartCollections` action
**Files:** `apps/web/src/app/actions/collections.ts:119-124`,
`apps/web/src/__tests__/smart-collections.test.ts` (or the Task-1 suite)
- [ ] Delete the export (zero callers — verified by grep; removal is the
      smallest surface). Note in the commit body why: `'use server'` exports
      register invokable endpoints; this one returned `is_public = false`
      rows with `query_json` to unauthenticated callers.
- [ ] Regression lock: assert the actions module no longer exports
      `getSmartCollections` (import-shape assertion).

## Task 3 — I18N-R4C5-03: localize collection/embeddings action-boundary errors
**Files:** `apps/web/src/app/actions/collections.ts:30-34,74-79`,
`apps/web/src/app/actions/embeddings.ts:111-114`,
`apps/web/messages/en.json`, `apps/web/messages/ko.json`
- [ ] collections create/update: catch parser errors → `console.warn`
      detail server-side → return `{ error: t('invalidCollectionQuery') }`
      (new key, EN+KO together).
- [ ] embeddings backfill: catch → `console.error` detail → return localized
      generic (`backfillFailed`-class key, EN+KO).
- [ ] Posture matches C6-RPF-03 / R4C4-05 lineage (generic localized error
      across the boundary, detail in server logs).

## Task 4 — COR-R4C5-04 + TEST-R4C5-07: close the download FileHandle on the stat-throw path
**Files:** `apps/web/src/app/api/download/[imageId]/route.ts:170-218`,
`apps/web/src/__tests__/refund-clears-download-token.test.ts`
- [ ] In the lstat/realpath/open catch: close the handle if it was assigned
      (`await fileHandle?.close().catch(() => undefined)` via a nullable
      local) before returning 404/500 — completes the R4C4-06 "cannot leak"
      contract.
- [ ] Test: stat-throw case asserting the handle is closed and the token
      NOT consumed.

## Task 5 — LOW-R4C5-05: strip ALL trailing dots in `extractTldPlusOne`
**Files:** `apps/web/src/lib/analytics.ts:103-110`,
`apps/web/src/__tests__/analytics.test.ts`
- [ ] `host.replace(/\.+$/, '')` instead of single-dot slice; both return
      paths already use the normalized value.
- [ ] Tests: `github.com..` and `github.com...` → `github.com`.

## Task 6 — DOC-R4C5-08 → **UPGRADED to COR-R4C5-09**: webhook insertedFresh gate ineffective under FOUND_ROWS
**Files:** `apps/web/src/app/api/stripe/webhook/route.ts:346-358`,
`apps/web/src/__tests__/stripe-webhook-source.test.ts:101-120`
- [x] While implementing the planned comment correction, the exact ODKU
      statement shape was live-probed: under mysql2 default FOUND_ROWS the
      no-op dup-key update reports `affectedRows = 1` — IDENTICAL to a
      fresh insert — so the R4C3-02 gate `affectedRows === 1` never
      filtered the race loser; the dead-token log lines it was built to
      suppress were still emitted. (Plain-UPDATE probe: no-op → (1,0
      changed); ODKU probe: fresh = (1, insertId>0); no-op dup = (1, 0);
      changed dup = (2, existing id).)
- [x] Gate fixed to the conjunction
      `insertHeader.affectedRows === 1 && insertHeader.insertId > 0`
      (entitlements.id is AUTO_INCREMENT, so a fresh insert always carries
      insertId > 0); comment rewritten with the live-verified semantics.
- [x] `stripe-webhook-source.test.ts` contract updated to pin the
      conjunction shape.
- [x] Aggregate amended with the COR-R4C5-09 addendum row (severity
      upgraded MED/High; the original DOC-R4C5-08 rationale-correction is
      subsumed).

## Gate work (after all tasks)
- [ ] eslint · typecheck · vitest · lint:api-auth · lint:action-origin ·
      lint:public-route-rate-limit · production build · Playwright e2e —
      all green on the whole repo before deploy.
