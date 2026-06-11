# Plan 309 — Run-4 Cycle 19 fixes

**Source review:** `.context/reviews/run4-cycle19/_aggregate.md`
**Status:** PENDING

Repo-rule constraints honored: GPG-signed commits (`-S`), conventional
commits + gitmoji, fine-grained per-fix commits, pull --rebase before
push, per-cycle gates (eslint, typecheck, vitest, api-auth,
action-origin, public-route-rate-limit, build, playwright e2e), deploy
per cycle via `npm run deploy`. HARD-SCOPE: no edit/culling/scoring
features.

## Task 1 — COR-R4C19-01 + TEST-R4C19-02: fix `topicRouteSegmentExists` tuple bug + tuple-accurate mocks (HIGH)

- [ ] `apps/web/src/app/actions/topics.ts:41-48`: unwrap the drizzle
      raw `db.execute` mysql2 `[rows, fields]` tuple with the house
      pattern (`Array.isArray(result) && Array.isArray(result[0]) ?
      result[0] : result`), with a comment naming the tuple contract
      (canonical doc: backfill-color-pipeline.ts:269) and this finding
      ID. `rows.length > 0` then operates on actual rows.
- [ ] `apps/web/src/__tests__/topics-actions.test.ts`: convert every
      `db.execute` mock to runtime-accurate tuples (`[[], []]`
      no-conflict; `[[{ found: 1 }], []]` conflict). Add/upgrade
      assertions: (a) createTopic SUCCEEDS on zero-row tuple,
      (b) createTopic errors on one-row tuple, (c) updateTopic slug
      rename succeeds on zero-row tuple, (d) createTopicAlias succeeds
      on zero-row tuple. Prove (a)/(c)/(d) failing pre-fix.
- Commit: `fix(topics): 🐛 unwrap db.execute tuple in topicRouteSegmentExists (COR-R4C19-01)`

## Task 2 — TEST-R4C19-07: admin topic-management e2e (MED)

- [ ] `apps/web/e2e/admin.spec.ts`: inside the `adminE2EEnabled`
      describe, add a self-cleaning spec: create a uniquely-named
      topic via /admin/categories UI → assert it appears in the
      categories table → delete it in finally. (The categories admin
      UI selectors to be confirmed from
      `app/[locale]/admin/(protected)/categories/`.)
- Commit: `test(e2e): ✅ admin topic create/delete coverage (TEST-R4C19-07)`

## Task 3 — COR-R4C19-03: backfill-cicp-recheck tuple unwrap (MED)

- [ ] `apps/web/scripts/backfill-cicp-recheck.ts:56-62`: same unwrap +
      comment as Task 1.
- Commit: `fix(scripts): 🐛 unwrap db.execute tuple in cicp-recheck (COR-R4C19-03)`

## Task 4 — COR-R4C19-04 + DOC-R4C19-05 (+OBS-R4C19-E): keyset pagination + implement documented gate (MED)

- [ ] `apps/web/scripts/backfill-alt-text.ts`: replace LIMIT/OFFSET
      with keyset pagination (`gt(images.id, cursor)` + `orderBy(asc)`
      + cursor advance); implement the documented
      `auto_alt_text_enabled` admin-setting gate with `--force`
      override, mirroring backfill-clip-embeddings.ts:42-61.
- [ ] `apps/web/scripts/backfill-clip-embeddings.ts`: same keyset
      conversion; remove the dead `skipped` counter (OBS-R4C19-E).
- Commit: `fix(scripts): 🐛 keyset pagination + documented alt-text gate (COR-R4C19-04, DOC-R4C19-05)`

## Task 5 — SEC-R4C19-06: migrate-titles refusal guard (MED-LOW)

- [ ] `apps/web/scripts/migrate-titles.ts`: refuse to run unless
      `--i-understand-this-clears-all-titles` is passed; print the
      would-be-affected row count and exit 1 otherwise. Additive only
      — no deletion (owner-sign-off rule, DEF-R4C16-A precedent).
- Commit: `fix(scripts): 🛡️ refusal guard on legacy title-clearing migration (SEC-R4C19-06)`

## Task 6 — OBS-R4C19-C: fail-closed star re-exports in the public-route gate (LOW)

- [ ] `apps/web/scripts/check-public-route-rate-limit.ts`: when a
      route file contains `export * from …` (ExportDeclaration without
      exportClause), fail the file with a message requiring named
      exports, mirroring check-api-auth's fail-closed posture.
- [ ] Extend `apps/web/src/__tests__/check-public-route-rate-limit.test.ts`
      (or create the fixture case in the existing suite file for this
      scanner) with a star-re-export fixture asserting failure.
- Commit: `fix(lint-gate): 🛡️ fail star re-exports in public-route scanner (OBS-R4C19-C)`

## Gate + deploy protocol

After Tasks 1-6: run all 8 gates against the whole repo; fix anything
red; SW version refresh commit if the build stamps it; `git pull
--rebase && git push` per commit; then `npm run deploy` once and probe
the live site.

## Progress log

(appended during PROMPT 3)
