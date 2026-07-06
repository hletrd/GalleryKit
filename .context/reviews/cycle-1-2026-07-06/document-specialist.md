# Cycle 1 (2026-07-06) — Document Specialist Review

Reviewer angle: documentation/code mismatches — factual claims in CLAUDE.md, AGENTS.md,
README.md (root + apps/web), `.env.local.example`, `site-config.example.json`,
`docker-compose.yml`, `nginx/default.conf`, `messages/{en,ko}.json` key/placeholder parity,
`package.json` scripts vs documented commands, the migration runbook vs `scripts/migrate.js`,
and inline "search for X in file Y" cross-file pointers.

HEAD reviewed: `657eb024` (== `origin/master` per the task brief; tree clean except this
session's own `.context/reviews/cycle-1-2026-07-06/` output). Read-only: no source files
modified.

Read first, per instructions, to avoid re-reporting known work: `.context/plans/cycle-96-2026-07-01-deferred.md`
(including C96-07 nginx demo-domain and C96-08 i18n copy items), `.context/plans/cycle-98-2026-07-01-deferred.md`,
`.context/reviews/cycle-99-2026-07-01/{architect,perf-reviewer}.md`, and this cycle's sibling
lanes `.context/reviews/cycle-1-2026-07-06/{verifier,critic,security-reviewer,test-engineer}.md`.
The verifier lane already ran a 49-claim CLAUDE.md verification table (48 PASS / 1 PARTIAL) —
none of that is repeated here; this review targets surfaces and claims the verifier did not
cover (product-reachability of a documented DB feature, the plans/reviews ledger's own
currency, and cross-file "search for" pointer precision).

---

## Findings

### DOC-01 — CLAUDE.md documents `smart_collections` as an admin-manageable feature, but the create/update/delete actions are wired to no UI or API surface anywhere in the app

- Severity: High.
- Confidence: High.
- Classification: Product/documentation mismatch (doc describes a reachable admin feature; the code path exists but is unreachable).
- Doc: `CLAUDE.md:161` — "`smart_collections` - Admin-defined dynamic galleries (US-P42)... Smart collection mutations (create, update, delete) are gated by `getRestoreMaintenanceMessage()` **like all other mutating admin actions**."
- Code: `apps/web/src/app/actions/collections.ts` exports `createSmartCollection`, `updateSmartCollection`, `deleteSmartCollection` (all `'use server'`, all correctly guarded with `requireSameOriginAdmin()` + `getRestoreMaintenanceMessage()` + `isAdmin()` — the implementation itself is sound and well-hardened).
- Why this is a mismatch: "Admin-defined dynamic galleries" and "like all other mutating admin actions" (a direct comparison to tags/topics/settings, which are all reachable from the dashboard) strongly implies an admin can define these through the product UI, the same as every other entity in the schema. That is not the case today:
  - `grep -rn "actions/collections"` across `apps/web/src/app/**`, `apps/web/src/components/**`, and `apps/web/src/__tests__/**` returns **zero hits** — no page, no component, and no test imports `createSmartCollection`/`updateSmartCollection`/`deleteSmartCollection` by any import path (alias or relative).
  - `apps/web/src/components/admin-nav.tsx:15-26` lists exactly 10 admin nav links (`dashboard`, `categories`, `tags`, `seo`, `settings`, `tokens`, `password`, `users`, `db`, `analytics`) — there is no "Collections" entry, and the `categories` page (`apps/web/src/app/[locale]/admin/(protected)/categories/{page,topic-manager}.tsx`) contains no case-insensitive match for "collection" at all.
  - There is no `apps/web/src/app/api/admin/**` route that calls any of the three mutation functions either — it is not exposed as a headless API alternative to a dashboard page.
  - `apps/web/messages/en.json` confirms the asymmetry: the `smartCollection` namespace (`en.json:711-714`) contains only public-facing strings (`ogDescription`, `notFoundTitle` for the `/c/[slug]` 404 page). The only consumers of `failedToCreateCollection` / `failedToUpdateCollection` / `failedToDeleteCollection` / `invalidCollectionQuery` are inside `collections.ts` itself — dead strings with no rendering path, unlike the token-management feature's admin-facing `lrToken.createTitle`/`createDesc`/`revokeAria` keys, which are wired to a real dialog (`tokens-client.tsx`).
  - By contrast, the **read** side of the feature is real: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx` exists and renders a smart collection correctly if a row exists in `smart_collections`.
  - `git log --oneline -- apps/web/src/app/actions/collections.ts` shows real, sustained engineering investment across multiple cycles (feature commit `52cb3308` "add CRUD server actions for smart collections (US-P42)", plus five follow-on hardening commits for validation, localization, dead-action removal, and restore-maintenance gating) — this is not abandoned scaffolding, it is a maintained server-side surface that was apparently never given a front-end entry point (or had one removed without the actions being removed).
- Impact scenario: an operator or new contributor reads CLAUDE.md's `smart_collections` bullet, expects to find a "New Smart Collection" control somewhere in the 10-page admin dashboard (the same way they'd find "New Category" on the Categories page), and cannot — the only way to populate `smart_collections` today is a direct SQL `INSERT` against `query_json`, which the docs never mention as the actual operating procedure. A reviewer relying on TEST-01 (this cycle's test-engineer finding, "smart-collection admin mutations have zero behavior-level test coverage") could reasonably conclude the gap is "just missing tests" — it is actually "missing product surface," which is a materially different and larger gap.
- Suggested fix: either (a) build the missing admin UI (a "Collections" nav entry + page, matching the CRUD pattern used for tags/topics) so the documented feature matches reality, or (b) if smart collections are intentionally DB/SQL-authored only for now, correct the CLAUDE.md bullet to say so explicitly (e.g., "currently authored via direct DB insert into `query_json`; no dashboard UI ships yet") so the doc does not overstate the feature's operability, and note the same in the `apps/web/README.md` feature list if smart collections are mentioned there (they currently aren't, which is itself consistent with option (b)).

### DOC-02 — The plans/reviews ledger is stale relative to HEAD: a committed cycle-99 review was never aggregated, indexed, or scheduled

- Severity: Medium.
- Confidence: High.
- Classification: Process/documentation currency (self-referential to this repo's own review-history docs, which `AGENTS.md:42` and `CLAUDE.md`'s "Production photographer-perspective audit history" section both treat as authoritative committed history).
- Doc: `.context/reviews/_aggregate.md:1-3` ("Current aggregate: `cycle-98-2026-07-01/`... Cycle 98 reviewed deployed `master` starting at `6f40f66d...`") and `.context/plans/README.md:5-14` ("Active Current-Cycle Plans" — newest entry is Cycle 98).
- Code/repo evidence: `git ls-files .context/reviews/cycle-99-2026-07-01/` shows `architect.md` and `perf-reviewer.md` are tracked; `git log --oneline -- .context/reviews/cycle-99-2026-07-01/` shows they were added by commits `8b09ce64` ("preserve cycle 99 perf evidence") and `657eb024` ("record cycle 99 architecture review") — and `657eb024` **is the current HEAD** per this task's own brief. Yet:
  - There is no `.context/reviews/cycle-99-2026-07-01/_aggregate.md`.
  - There is no `.context/plans/cycle-99-2026-07-01-plan.md` or `-deferred.md` anywhere under `.context/plans/` (confirmed via directory listing — the newest files present are the cycle-98 pair).
  - `.context/plans/README.md` and `.context/reviews/_aggregate.md` both still describe cycle 98 as current; neither mentions cycle 99 at all.
  - The cycle-99 architect lane's one confirmed finding ("Over-limit public load/view requests still force persistent limiter DB work," `.context/reviews/cycle-99-2026-07-01/architect.md:17-38`) was therefore never scheduled into a plan and never recorded into the deferred register — it is simply absent from every ledger document a future cycle would consult.
- Why it matters: this is the same "orphaned review" failure mode this cycle's own critic lane documented for cycle 94 (`.context/reviews/cycle-1-2026-07-06/critic.md`, CRIT-02) — a review ran, was committed, and then the loop moved on without folding it into the authoritative index. It recurred one cycle before the present one, which the critic's own review (run against an older, now-superseded HEAD) could not have caught. It also suggests cycle 99 was a partial run (2 lanes: architect + perf-reviewer) compared to cycle 98's 6-lane aggregate (`security-reviewer`, `correctness-data-reviewer`, `ui-ux-reviewer`, `tests-contracts-reviewer`, `performance-operability-reviewer`, `build-deploy-ledger-reviewer`), consistent with an interrupted/never-finalized cycle.
- Impact scenario: a future cycle (or a human operator) reads `.context/plans/README.md` "Do not infer unresolved implementation work from this README alone" caveat, follows the trail to the "latest" `_aggregate.md`, stops at cycle 98, and never sees the cycle-99 architect finding — repeating the exact loss-of-work pattern the critic flagged for cycle 94, now for cycle 99.
- Suggested fix: add a `.context/reviews/cycle-99-2026-07-01/_aggregate.md` (or fold cycle 99's single finding into the next active plan/deferred file), update `.context/reviews/_aggregate.md`'s "Current aggregate" pointer, and add a Cycle 99 line to `.context/plans/README.md`'s "Active Current-Cycle Plans" section — either scheduling or explicitly deferring the architect's rate-limiter finding so it is not silently dropped the way the cycle-94 findings were.

### DOC-03 — "Search for `ProPhoto`" pointer in CLAUDE.md doesn't match the actual (lowercase) identifier in the target file

- Severity: Very Low.
- Confidence: High.
- Classification: Cross-file pointer precision (the specific class of claim the task asked to spot-check).
- Doc: `CLAUDE.md:172` — "`gamma18` comes from ICC name heuristics (search `apps/web/src/lib/color-detection.ts` for `ProPhoto`, AGG-D3)".
- Code: `apps/web/src/lib/color-detection.ts` contains only the lowercase string/identifier `prophoto` (lines 68, 108, 151: `name.includes('prophoto')`, etc.) — there is no `ProPhoto` (mixed-case) substring anywhere in the file.
- Why: a literal case-sensitive search for `ProPhoto` in that file, exactly as instructed, returns zero matches; the heuristic is real and correctly described in substance (line 108: `if (name.includes('prophoto')) return 'gamma18';`), only the casing of the quoted search term is wrong.
- Impact scenario: negligible in practice (any case-insensitive grep/editor search, or a human skimming the file, finds it immediately) — noted only because the reviewing brief specifically asked to confirm each "search for X" pointer still resolves as literally stated.
- Suggested fix: lowercase the quoted term to `search apps/web/src/lib/color-detection.ts for `prophoto``, matching the file's actual casing.

---

## Non-findings (checked, no drift)

- **i18n placeholder parity beyond key-set equality**: `apps/web/src/__tests__/i18n-key-parity.test.ts` intentionally checks only leaf-key set equality (by design, per its own docblock and CLAUDE.md's "i18n plural convention" note, since en uses ICU `plural` blocks and ko uses a fixed form). I additionally programmatically extracted every non-numeric `{identifier}` interpolation token from every shared leaf key in `en.json`/`ko.json` and diffed them pairwise — **zero mismatches** once ICU `plural`/`select` keywords and literal digits inside plural arms (e.g., the `1` in `{count, plural, one {1 file...}}`) are excluded. No dropped/added interpolation variables in either locale.
- **Migration runbook** (`CLAUDE.md` "Migration & Schema-Drift Runbook" + `AGENTS.md` "Schema" section) accurately describes current `apps/web/scripts/migrate.js`: `getAllJournalMigrations` (line 180), `reconcileLegacySchema` (317), `baselineAllJournalMigrations` (747), `prepareLegacyDatabaseIfNeeded` (764), `runMigrations`'s post-condition throw with the exact "Drizzle silently skipped N migration(s)" wording (818) all match.
- **Docker healthcheck**: CLAUDE.md's "Docker liveness should probe `/api/live`" and the `.env.local.example`/README `/api/health` liveness-only + `HEALTH_CHECK_DB` claims match `apps/web/Dockerfile:154-157`'s actual `HEALTHCHECK` command exactly (`http://localhost:3000/api/live`).
- **Admin token format/scopes**: `AdminTokenScope = 'lr:upload' | 'lr:read' | 'lr:delete'`, the `x-gallerykit-token` header constant, `allowTokenScope` wiring in `withAdminAuth`, and `expires_at`/`last_used_at` columns all match CLAUDE.md's `admin_tokens` bullet exactly (`apps/web/src/lib/admin-tokens.ts`, `apps/web/src/lib/api-auth.ts:15,34,72-83`, `apps/web/src/db/schema.ts:207-208`).
- **`lr-tokens.ts` / `tokens-client.tsx`**: `createLrToken`/`revokeLrToken`/`listLrTokens` match the documented create/revoke admin Tokens-page workflow; "rotated" in CLAUDE.md's phrasing is satisfied by create-new + revoke-old (there is no literal one-click "rotate" button, but this isn't a doc claim of a dedicated rotate action — not filed as a finding).
- **nginx body-size caps**: every cap quoted in `CLAUDE.md`, `README.md`, and `apps/web/README.md` (2 MiB general / 64 KiB login / 250 MiB DB restore / 216 MiB dashboard uploads / 216 MiB `/api/admin/lr/upload`) matches `apps/web/nginx/default.conf` byte-for-byte at each corresponding `location` block.
- **Topic image dimensions**: the `.env.local.example` comment "topic images are 512x512" matches `apps/web/src/lib/process-topic-image.ts:110` (`resize({ width: 512, height: 512, ... })`) and the mirroring comment in `process-image.ts:361`.
- **`hdr-filenames.ts`**: confirmed genuinely unwired outside its own test, consistent with CLAUDE.md's "RESERVED — NOT WIRED until WI-09 ships" framing (no non-test importer anywhere).
- **`COLOR_IMPACTING_KEYS`**: confirmed to be a plain re-export alias of `DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS` (`settings-hash.ts:47`) — the two names CLAUDE.md and the verifier's evidence cite are the same single source of truth, not a drifted duplicate.
- **package.json scripts vs documented commands**: root and `apps/web` `package.json` scripts match every command quoted in `CLAUDE.md`, `AGENTS.md`, `README.md`, and `apps/web/README.md` (dev/build/lint/typecheck/test/test:e2e/db:push/db:seed/init/deploy and the three `lint:*` gates).
- **nginx XFF/demo-domain issues**: not re-reported — `SEC-01` (this cycle's `security-reviewer.md`) already covers the `$remote_addr` XFF-overwrite contradiction, and `server_name gallery.atik.kr` is the already-deferred `C96-07`.

## Docs/areas examined

- `CLAUDE.md` (full pass, all sections cross-checked against source, with extra attention to the sections covering `image-queue.ts`, `rate-limit.ts`, `admin-tokens.ts`, `data.ts`, `serve-upload.ts`/ETag, migration runbook, and Docker healthcheck as flagged in the task brief).
- `AGENTS.md` (full).
- `README.md` (root, full) and `apps/web/README.md` (full), including the Upload API contract, semantic-search runbook, and Scripts table.
- `apps/web/.env.local.example` (full) cross-checked against `CLAUDE.md`'s "Optional Operational Variables" table and actual code defaults.
- `apps/web/src/site-config.example.json` vs `apps/web/src/site-config.json` (real) and the README's documented key list — keys match 1:1.
- `apps/web/docker-compose.yml` and `apps/web/nginx/default.conf` (full), cross-checked against every quoted cap/topology claim in `CLAUDE.md`/README.
- `apps/web/messages/en.json` vs `ko.json` — full leaf-key flatten + ICU placeholder-token diff (programmatic, not just the existing key-parity test).
- `package.json` (root) and `apps/web/package.json` `scripts` blocks vs every documented command across all four main doc files.
- `apps/web/scripts/migrate.js` vs the "Migration & Schema-Drift Runbook" section (function-by-function).
- `.context/plans/README.md` and `.context/reviews/_aggregate.md` currency against actual `git log`/`git ls-files` state of `.context/reviews/cycle-99-2026-07-01/` and `.context/plans/`.
- Targeted cross-file "search for X in file Y" pointer audit: `IMAGE_PIPELINE_VERSION` (gallery-config-shared.ts), `smartCollections` (schema.ts), `ProPhoto`/`prophoto` (color-detection.ts), `WI-14 / R8-R8` (process-image.ts), `COLOR_IMPACTING_KEYS` (settings-hash.ts) — all traced to their cited files; only the `ProPhoto` casing did not match literally.
- `apps/web/src/components/admin-nav.tsx`, `apps/web/src/app/actions/collections.ts`, and the categories admin page tree, to determine smart-collection admin-UI reachability (DOC-01).

## Commonly-missed-issues sweep

- Confirmed no *other* CLAUDE.md `search for X` / `search \`Y\`` pointer besides the ProPhoto one is mis-cased or points at a removed symbol — the other four checked all resolved exactly as quoted.
- Confirmed the `.env.local.example` and `apps/web/README.md` "Environment notes" section do not contradict `CLAUDE.md`'s "Optional Operational Variables" table on any default value (spot-checked `SHARP_CONCURRENCY`, `IMAGE_MAX_INPUT_PIXELS_TOPIC`, `BACKFILL_CONCURRENCY`, `VIEW_RETENTION_DAYS`).
- Confirmed `docker-compose.yml`'s build-arg forwarding (`BASE_URL`, `IMAGE_BASE_URL`, `UPLOAD_MAX_TOTAL_BYTES`, `NEXT_UPLOAD_BODY_MAX_BYTES`) matches the README's "do this before `--build`" instructions — all four args are declared in the compose file's `build.args` block, none are missing or extra relative to what the docs describe.
- Checked whether any other schema table documented in CLAUDE.md's "Database Schema (Key Tables)" section suffers the same unreachable-admin-UI problem as smart collections: `admin_tokens` (reachable via Tokens page — confirmed), `image_embeddings` (backfill-only by design, documented as such), `smart_collections` (DOC-01) is the only one found with this gap.
- Did not re-open `C96-04`, `C96-07`, `C96-08`, `C96-09` through `C96-17`, or any `C94/C93`-numbered carry-forward item — all were read first and none of DOC-01/02/03 overlaps their citations or subject matter.
- Did not duplicate the verifier lane's 49-claim table; spot-checked a disjoint set of ~15 additional specific claims (admin token scopes/header, migration runbook internals, Docker healthcheck target, topic image dimensions, nginx caps, package.json scripts, i18n placeholders) as corroboration rather than new findings, all of which passed and are recorded above as non-findings rather than restated as verified claims.

## Caveats

- DOC-01's severity assumes CLAUDE.md's documentation is meant to reflect current, operator-facing reality (consistent with the rest of the file's style, e.g. explicit "NOT YET INTEGRATED" / "RESERVED — NOT WIRED" callouts elsewhere for genuinely unshipped surfaces). If the smart-collections admin UI is deliberately deferred product scope, the correct fix is a documentation clarification rather than new UI work — I did not find any existing callout in CLAUDE.md that already discloses this gap the way it does for `hdr-filenames.ts` or the storage-backend abstraction.
- DOC-02's fix is a ledger/process action, not a source-code change; I did not attempt to write the missing `_aggregate.md`/plan file myself, per the read-only review mandate.
