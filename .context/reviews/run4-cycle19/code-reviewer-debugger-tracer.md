# Run-4 Cycle 19 — code-reviewer + debugger + tracer angle

Inventory basis: mention-count map over run4-c1..c18 review corpora
(10,385 lines) ranked every non-test source file; this cycle rotates to
the **zero/near-zero-coverage operational scripts cluster**
(`apps/web/scripts/*`, 0-1 mentions each), the **e2e suite**
(`apps/web/e2e/*`, 0-1 mentions), and the raw-`db.execute` consumer
sweep that the scripts review triggered. Regression review of all three
cycle-18 fix commits included. No sampling: every file under
`apps/web/scripts/` and `apps/web/e2e/` was read end-to-end.

## Regression review of cycle-18 fixes — SOUND

- `b4a5795c` (feed locale 404): `isSupportedLocale` guard sits above all
  three data-layer calls; 404 body is empty; no cache header divergence.
- `ff0fb549` (stripe deleted-image): `!currentImage` guard between
  SELECT and INSERT + `ER_NO_REFERENCED_ROW_2` catch both return 200
  with the manual-refund error log; transient-500 contract retained.
- `096bfceb` (rate-limit Pattern 4 registry): comment-only, verified.

## COR-R4C19-01 — `topicRouteSegmentExists` always returns true: topic create / rename / alias-create hard-broken — **HIGH / High (CONFIRMED empirically)**

- **Citation:** `apps/web/src/app/actions/topics.ts:41-48`; call sites
  `:126` (createTopic), `:232-234` (updateTopic slug rename), `:426`
  (createTopicAlias). Introduced by `515bc639` (2026-04-28,
  C3L-CR-02 "combine into single UNION query" perf change).
- **Mechanism:** drizzle-orm 0.45.2's raw `db.execute(sql...)` on the
  mysql2 driver returns the underlying **mysql2 `[rows, fields]`
  tuple**, not a rows array:
  - `node_modules/drizzle-orm/mysql2/session.js:52-77` — the
    no-fields/no-mapper path ends in `return res;` where
    `res = await client.query(rawQuery, params)`;
  - `node_modules/drizzle-orm/mysql-core/session.js:99-103` —
    drizzle's own `count()` unwraps with `res[0][0]["count"]`,
    confirming the tuple contract;
  - the repo itself documents the tuple at
    `apps/web/scripts/backfill-color-pipeline.ts:269` and unwraps it
    at `apps/web/src/lib/admin-tokens.ts:147,178,221,232` and
    `apps/web/src/lib/admin-backfill-runner.ts:153,167` — the
    knowledge never reached `topics.ts`.
- **Empirical proof (this cycle):**
  1. Stub-client run: `db.execute(sql)` with a zero-row stub returned
     `[[],[]]`, `length 2`, `rows.length > 0 === true`.
  2. **Live-DB run** against the real e2e MySQL with a nonexistent
     slug: `rows.length = 2`, `rows.length > 0 = true`, actual
     matching rows `= 0`.
- **Failure scenario (production, since 2026-04-28):** every
  `createTopic` returns `{ error: slugConflictsWithRoute }`; every
  `updateTopic` that changes a slug throws
  `SlugConflictsWithRouteError`; every `createTopicAlias` errors.
  Admin cannot create topics or aliases or rename topic slugs at all.
  No 500s, no logs — a clean-looking localized validation error, which
  is why it has been invisible to error monitoring.
- **Why tests stayed green:** `topics-actions.test.ts:185,251,389`
  mock `db.execute` to resolve a **bare array** (`[]` /
  `[{found:1}]`), a shape the runtime driver never produces. The mocks
  encode the bug's assumption.
- **Fix:** unwrap with the house pattern
  (`Array.isArray(result) && Array.isArray(result[0]) ? result[0] :
  result`) + explanatory comment mirroring
  backfill-color-pipeline.ts:269; convert test mocks to
  runtime-accurate tuples; add a regression assertion that a
  no-conflict create **succeeds** (proven failing pre-fix). An admin
  e2e topic CRUD spec is the gold lock (see test-engineer).

## COR-R4C19-03 — backfill-cicp-recheck iterates the tuple as rows — **MED / High (CONFIRMED, same mechanism)**

- **Citation:** `apps/web/scripts/backfill-cicp-recheck.ts:56-62`
  (`const rawRows = await db.execute(sql...)`;
  `rows = rawRows as unknown as DbRow[]`), loop at `:79`.
- **Failure scenario:** `rows.length` is always 2; the loop visits
  `[RowDataPacket[], FieldPacket[]]` as two pseudo-rows;
  `resolveOriginalUploadPath(row.filename_original)` receives
  `undefined` at `:81` **outside** the try/catch → the `queue.add`
  task rejects → unhandled rejection (PQueue task promises are not
  awaited; `queue.onEmpty()` does not surface them) → Node 24 crash;
  best case the operator reads "2 candidate image(s)" on any DB. The
  NCLX-flip diagnostic is unusable.
- **Fix:** same tuple unwrap as COR-R4C19-01.

## COR-R4C19-04 — offset pagination over a shrinking WHERE set skips ~half the backlog — **MED / High (CONFIRMED by construction)**

- **Citation:** `apps/web/scripts/backfill-alt-text.ts:44-91`
  (`WHERE processed AND alt_text_suggested IS NULL … LIMIT 50 OFFSET
  offset`, then `offset += rows.length` after UPDATEs that remove the
  rows from the WHERE set); `apps/web/scripts/backfill-clip-embeddings.ts:66-126`
  (`notExists(embedding row)` + same offset advance; the `:125`
  early-break only masks the final page).
- **Failure scenario (alt-text, 200-row backlog):** batch 1 updates
  rows 1-50; the filtered set is now rows 51-200; `OFFSET 50` returns
  rows 101-150, silently skipping 51-100; next `OFFSET 100` of the
  100 remaining rows returns empty → loop exits with 100 of 200 rows
  processed and a success summary. Same shape for clip-embeddings.
- **Fix:** keyset pagination (`WHERE id > cursor ORDER BY id ASC
  LIMIT n`, cursor = last row id). Keyset is the only shape that
  survives BOTH the shrinking filter AND permanently-unprocessable
  rows (alt-text rows whose caption is empty stay NULL and would
  infinite-loop a naive "no offset" re-query; clip rows that fail
  keep matching `notExists`).
- Also: `backfill-clip-embeddings.ts:64` `const skipped = 0` is a dead
  counter printed in the summary — fold the cleanup into the same edit.

## SEC-R4C19-06 — `migrate-titles.ts` unguarded `UPDATE images SET title = NULL` — **MED-LOW / High (data-loss footgun, dormant)**

- **Citation:** `apps/web/scripts/migrate-titles.ts:17-21` — second
  statement clears EVERY title, no WHERE, no flag, no prompt.
- **Failure scenario:** the title→user_filename migration this script
  served completed long ago; running it today (tab completion,
  cargo-culted doc snippet) silently NULLs all current photo titles —
  data produced by admins since then. There is no undo short of a DB
  restore.
- **Fix:** additive guard — refuse to run unless
  `--i-understand-this-clears-all-titles` is passed (echoing the
  affected-row count first). Deleting the legacy script outright would
  need owner sign-off per the destructive-action precedent
  (DEF-R4C16-A); a guard does not.

## Lower-severity / recorded

- **OBS-R4C19-A (LOW/Medium):** `scripts/seed-admin.ts` (wired to
  `npm run db:seed`) lacks the `$$argon2` double-escape normalization
  its sibling `scripts/migrate-admin-auth.ts:42-44` has. A
  compose-interpolated `ADMIN_PASSWORD=$$argon2…` would silently pass
  `assertStrongBootstrapPassword` (length > 16) and be re-hashed as
  plaintext → admin login fails with the real password and nothing
  explains why. Exit criterion: first support report of bootstrap
  login failure with a pre-hashed compose env, or next functional edit
  of seed-admin.ts.
- **OBS-R4C19-D (INFO):** `scripts/migrate-capture-date.js:54-59`
  strips `Z` only when milliseconds exist (`SUBSTRING_INDEX(…,'.',1)`);
  a second-precision `…T10:30:00Z` keeps its trailing `Z` and the
  `:63` `ALTER … DATETIME` would fail under strict SQL mode. Dormant:
  every live DB is already DATETIME and the `:40` type check
  early-returns.
- **OBS-R4C19-B (INFO):** `scripts/check-api-auth.ts:162` uses bare
  `require.main === module` where its sibling gate
  (`check-public-route-rate-limit.ts:179`) guards with
  `typeof require !== 'undefined'`. Dormant under tsx CJS execution.
- `scripts/migration-add-column.ts`, `scripts/migrate-aliases.ts`:
  idempotent one-shots, harmless re-runs (CREATE IF NOT EXISTS /
  ADD COLUMN IF NOT EXISTS). `scripts/init-db.ts` delegates to
  migrate.js with inherited env — clean.

## Clean-pass files (this angle)

`seed-e2e.ts` (NODE_ENV guard, FK-cascade-aware cleanup verified
against schema.ts:225 `image_views … onDelete: 'cascade'`),
`mysql-connection-options.js` (TLS-by-default for non-local hosts),
`entrypoint.sh` (top-level-owner fast path; nested-ownership partial
chown edge is theoretical), `run-e2e-server.mjs` (host/port allowlist),
`build-sw.ts` (execFileSync, no shell), `check-js-scripts.mjs`,
`ensure-site-config.mjs` (placeholder-host refusal), `generate-pwa-icons.ts`,
`prepare-next-typegen.mjs`, `download-clip-models.ts` (stub),
`backfill-color-pipeline.ts` (tuple handled + documented),
`src/lib/upload-tracker-state.ts`, `src/lib/bulk-edit-types.ts`,
`admin/password/password-client.tsx`.
