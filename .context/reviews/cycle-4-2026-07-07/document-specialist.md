# Run-10 Cycle 4 — Document Specialist Review

Start HEAD: `ec433dc4` (terminal commit of run-10 cycle-3, "close run-10 cycle-3 ledger with
post-deploy evidence"). Angle: documentation-vs-code mismatches, verified against the code
itself and (where relevant) official upstream docs.

Scope covered: `CLAUDE.md` diff from cycle-3 (`e08b6f97..ec433dc4`), `apps/web/README.md`,
`apps/web/nginx/default.conf`, inline comments in the 14 `.ts`/`.tsx` source files cycle-3
touched, `.context/plans/README.md` index accuracy, a full `process.env.*` audit across
`apps/web/src` + `apps/web/scripts` against the CLAUDE.md env-var table and
`.env.local.example`, and `package.json` scripts vs documented commands.

Method: every finding below was verified by reading the actual current source at HEAD, not
inferred from the plan/aggregate prose. One claim (`not-found.tsx` metadata support) was
checked against the live Next.js 16.2.10 docs via WebFetch/WebSearch since it's a specific,
checkable framework-API claim baked into a cycle-3 code comment — it held up.

## Findings

### DOC4-01 — CLAUDE.md's new "DDL-only invariant" claim is contradicted by existing code (MED-HIGH / High)

- **Doc:** `CLAUDE.md:446` (added this cycle, WP1/C3-01): *"**DDL-only invariant:**
  `reconcileLegacySchema` mirrors DDL only, NEVER DML — any migration carrying a DML backfill
  relies exclusively on the drizzle-apply path, which is exactly why baselining an unexecuted
  migration is forbidden."*
- **Code:** `apps/web/scripts/migrate.js:550-561`, inside `reconcileLegacySchema` itself:
  ```js
  const addedPosition = await ensureColumn(connection, dbName, 'shared_group_images', 'position', ...);
  if (addedPosition) {
      await connection.query(`
          UPDATE shared_group_images AS sgi
          JOIN ( SELECT group_id, image_id, ROW_NUMBER() OVER (...) - 1 AS computed_position
                 FROM shared_group_images ) AS ordered
            ON ordered.group_id = sgi.group_id AND ordered.image_id = sgi.image_id
          SET sgi.position = ordered.computed_position
          WHERE sgi.position = 0
      `);
  }
  ```
  This is a genuine `UPDATE` (DML), conditionally executed the first time `reconcileLegacySchema`
  adds the `position` column to a legacy DB (`ensureColumn` returns `true` only when the column
  didn't previously exist — confirmed at `migrate.js:237-244`). It has existed since commit
  `4415ee8e` (2026-04-14), months before this cycle.
- **Which is right:** the code. The blanket "NEVER DML" claim is false as written — there is at
  least one legacy conditional-DML backfill already living inside `reconcileLegacySchema`. The
  claim was added THIS cycle (WP1) to justify the new mixed-case baselining trade-off
  ("`reconcileLegacySchema` mirrors DDL only... resolve the drift, then baseline those entries
  manually") without checking it against the function it describes.
- **Why it matters:** the whole cycle-3 mixed-case fix (C3-01) rests on the argument that
  baselining true-drift entries is safe because reconcile only does idempotent/re-runnable DDL.
  The position backfill shows that isn't universally true — it's a one-shot, gated DML. It
  happens to be safely idempotent-in-effect (the `WHERE sgi.position = 0` + `addedPosition` gate
  mean it only fires once), but a future engineer relying on the literal "NEVER DML" invariant to
  reason about migration safety, or to justify adding a similar backfill without the same care,
  would be misled.
- **Suggested fix:** qualify the claim, e.g.: *"`reconcileLegacySchema` mirrors schema DDL; the
  one narrow exception is a self-gated, one-time ordering backfill for
  `shared_group_images.position` (runs only when `ensureColumn` reports the column was just
  added). Any FUTURE migration carrying a DML backfill must rely on the drizzle-apply path, not
  a new reconcile-side UPDATE, to keep this exception from growing."*
- **Confidence:** High (both texts read directly at HEAD). **Status:** open.

### DOC4-02 — Self-contradicting docstring in `gallery-config.ts` (both halves edited this cycle) (MED / High)

- **Code (doc-as-code):** `apps/web/src/lib/gallery-config.ts:196-201` (edited this cycle to add
  the backfill-runner mention): *"Detached background call sites — the three in
  `image-queue.ts` plus the admin backfill runner's detached `runBackfill` (C3-04) — MUST use
  this uncached accessor instead of `getGalleryConfig()` so **every invocation re-reads current
  admin settings**."*
- Twelve lines below, in a paragraph ALSO added this cycle (`gallery-config.ts:203-233`,
  PERF3-01/C3-16): `getGalleryConfigUncached` now carries a 2-second module-level TTL cache with
  in-flight dedupe — it explicitly does **not** re-read on every invocation within that window.
- **Which is right:** neither reads cleanly against the other. The 2 s micro-cache paragraph is
  the more recent, more specific truth; the "every invocation re-reads" sentence one paragraph
  above it is now factually wrong (or at best relies on a reader inferring "well, within 2 s" that
  the text never states).
- **Why it matters:** this function is exported and its name (`getGalleryConfigUncached`) plus
  the un-updated sentence together actively assert a stronger freshness guarantee than the code
  provides. A future caller who needs sub-2-second freshness (unlikely today, but the function's
  name and docstring are the only signal a caller has) would reasonably but wrongly conclude
  every call is a live read.
- **Suggested fix:** amend the first paragraph's last clause to something like *"...so every
  invocation observes current admin settings within the micro-cache's freshness window (see
  below) rather than a request-scoped memo that could live far longer."* Also worth a one-line
  note that the export name predates the cache and is kept for call-site compatibility.
- **Confidence:** High. **Status:** open.

### DOC4-03 — CLAUDE.md quotes a variable name that doesn't exist in the source (LOW / High)

- **Doc:** `CLAUDE.md:446`: *"...followed by `baselineAllJournalMigrations(connection,
  trueDriftEntries, { maxFolderMillis: cursor })`..."*
- **Code:** `apps/web/scripts/migrate.js:857,870`: the variable is `trueDrift`, not
  `trueDriftEntries` — `const trueDrift = cursor === null ? missing : missing.filter(...)` ...
  `await baselineAllJournalMigrations(connection, trueDrift, { maxFolderMillis: cursor });`
- **Which is right:** the code (`trueDrift`). This is a direct code-quote in CLAUDE.md meant to
  be copy/grep-able — `grep trueDriftEntries scripts/migrate.js` returns nothing.
- **Suggested fix:** s/trueDriftEntries/trueDrift/ in CLAUDE.md.
- **Confidence:** High. **Status:** open. Cosmetic — bundle with any other migrate.js doc touch.

### DOC4-04 — CLAUDE.md's Service Worker section never documents the `touchMeta` recency/durability mechanism (MED / High)

- **Doc:** `CLAUDE.md:426-432` ("Service Worker / PWA (US-P24)") describes only: the build/stamp
  pipeline, `sw-cache.ts` as the LRU reference implementation, the 50 MB cap, and the
  `HEAD_REVALIDATE_TIMEOUT_MS` bound. It says nothing about `touchMeta`, the fact that the LRU
  meta store (not the `sw-cached-at` response header) is now the **sole recency authority** for
  eviction, that `touchMeta` is now **awaited inside `respondWith`'s promise chain** for
  durability (C3-10, fixing a real termination/write-failure freeze bug), or the size-0 avoidance
  rule (C3-22).
- **Code:** `apps/web/public/sw.template.js:161-213,349-389`, `apps/web/src/lib/sw-cache.ts:201-244`.
  Both were edited this cycle specifically to fix C3-10 (durability) and C3-22 (size-0 LRU
  entries) — three cycle-3 lanes flagged this mechanism independently (tracer TRC3-02, critic
  CRIT3-05, perf PERF3-03), the aggregate calls it out by name as "three facets of the same
  C2-11 residual," and cycle-3's plan (WP16) explicitly lists which CLAUDE.md edits were folded
  into which WPs — WP5 (the SW fix) is NOT among them.
- **Which is right:** the code is correct and now well-commented in-file; CLAUDE.md is simply
  silent on a mechanism substantial enough to have generated three independent findings last
  cycle. This isn't a contradiction, it's a coverage gap on a load-bearing correctness invariant.
- **Why it matters:** the C2-11 → C3-10/C3-22 chain shows this exact code area has already
  regressed once (fire-and-forget write → termination drop → spurious eviction) and been fixed
  twice. Without CLAUDE.md stating "the meta store's timestamp is authoritative, writes MUST stay
  inside `respondWith`'s lifetime, and a 0-resolved size MUST NOT be recorded," a future editor of
  `sw.template.js` has no repo-level signal (only inline comments) that these are invariants, not
  incidental implementation choices.
- **Suggested fix:** add 2-3 sentences to the Service Worker section describing: (1) the LRU meta
  store's timestamp — not the `sw-cached-at` header — is authoritative for eviction once an entry
  has a meta record; (2) `touchMeta` writes must stay inside the fetch handler's lifetime
  (awaited, not fire-and-forget) or SW termination silently freezes recency; (3) a meta write that
  would record size 0 for a real cached body is skipped rather than corrupting the LRU byte count.
- **Confidence:** High (grepped CLAUDE.md for `touchMeta`/`recency`/`LRU`/`C2-11` — zero hits
  outside the `sw-cache.ts` one-line pointer). **Status:** open.

### DOC4-05 — `.context/plans/README.md`'s cycle-3 entry is stale: still "Active" after the cycle closed (LOW-MED / High)

- **Doc:** `.context/plans/README.md`, "## Active Current-Cycle Plans" section, still lists
  *"Run-10 Cycle 3/100 Implementation Plan - 12-lane review from start HEAD `e08b6f97`..."* with
  no completion marker, while "## Recent Plans" starts at Cycle 2.
- **Reality:** cycle-3's own aggregate/plan record 17 signed commits pushed
  (`e08b6f97..24c46745`), all gates green, Ralph verdict APPROVED, a successful `npm run deploy`,
  and a final closing commit `ec433dc4` ("docs(review): close run-10 cycle-3 ledger with
  post-deploy evidence") — i.e. cycle-3 is fully complete and deployed as of this review's start
  HEAD.
- **Which is right:** the git history / aggregate. The README's own established convention (see
  the Cycle 1 and Cycle 2 entries, both under "Recent Plans" with "COMPLETED" / "COMPLETED +
  deployed" prefixes) is to move a cycle out of "Active" once it closes — that move never
  happened for cycle-3, seemingly because the closing commit (`ec433dc4`, a docs-only ledger
  commit) landed after WP16's README edit and nothing updated the README a second time.
- **Why it matters:** this file exists specifically as "a convenience pointer for agents" (its own
  first line). An agent skimming it at the start of a future cycle could reasonably infer cycle-3
  work is still in flight and second-guess whether it's safe to start cycle-4 review, exactly the
  failure mode the README's own "Do not infer unresolved implementation work from this README
  alone" caveat exists to guard against — but the "Active" section is the first thing a skim
  would hit.
- **Suggested fix:** move the Cycle 3 bullets to "Recent Plans" with a "COMPLETED + deployed"
  prefix (mirroring Cycle 1/2), and note Cycle 4 as the new active review once this cycle's plan
  is written.
- **Confidence:** High. **Status:** open — trivial one-time fix, natural to fold into this
  cycle's docs/ledger work package.

### DOC4-06 — Env-var table gaps: two real runtime path overrides are undocumented (LOW / Medium)

Full audit of every `process.env.*` read (direct and via the `parsePositiveIntEnv`/
`parseBoundedPositiveInteger` wrappers) across `apps/web/src` and `apps/web/scripts`, cross-checked
against CLAUDE.md's env-var table and `.env.local.example`:

- `RESTORE_MAINTENANCE_DIR` (`apps/web/src/lib/restore-maintenance-durable.ts:24`,
  `apps/web/scripts/restore-maintenance-recovery.mjs:21`) overrides the durable restore-maintenance
  marker's directory (defaults to `/app/data` in production, `data` in dev). CLAUDE.md documents
  the marker mechanism and recovery CLI at length ("Restore-maintenance recovery" bullet under
  Race Condition Protections) but never mentions this override exists. Not referenced in
  `docker-compose.yml`/`Dockerfile`, so low urgency, but it's a real production-reachable knob
  (unlike its `NODE_ENV==='test'`-gated sibling `RESTORE_MAINTENANCE_MARKER_PATH`, which is
  correctly out of scope for operator docs).
- `UPLOAD_ROOT` (`apps/web/src/lib/upload-paths.ts:14`) is the identically-patterned sibling of
  the documented `UPLOAD_ORIGINAL_ROOT` (same file, same override idiom) but is absent from the
  CLAUDE.md table. In practice it's exercised only by 4 test files today and isn't part of any
  documented sidecar/backfill command the way `UPLOAD_ORIGINAL_ROOT` is, so this is asymmetric
  documentation rather than a missing operator feature — noting for completeness/consistency
  rather than as an incident risk.
- `TOPIC_RESOURCES_ROOT` / `TOPIC_RESOURCES_TMP_ROOT` (`apps/web/src/lib/process-topic-image.ts:11-39`)
  are explicitly test/sandbox-only per their own comment ("ORCH-C3-TMPDIR... so tests... can
  redirect topic-image scratch") — correctly out of scope for the operator-facing env-var table.
  Listed here only so the audit trail shows they were checked and intentionally excluded.
- `NEXT_PUBLIC_GA_ID` (`apps/web/src/lib/content-security-policy.ts:99`) is a default-parameter
  fallback for `buildContentSecurityPolicy`'s `googleAnalyticsId` — but the only real production
  call path (`apps/web/src/proxy.ts:47-51`, via `buildCspSafely`) always passes
  `googleAnalyticsId: siteConfig.google_analytics_id` explicitly, so the env var default is
  effectively unreachable dead code in production. CLAUDE.md correctly never documents
  `NEXT_PUBLIC_GA_ID` as a supported override (GA is documented as `site-config.json`'s
  `google_analytics_id`, consistent with the deployment checklist) — this is a code-cleanliness
  observation, not a doc-vs-code mismatch, included for completeness.
- **Suggested fix:** add a `RESTORE_MAINTENANCE_DIR` row to the CLAUDE.md env-var table (default
  `/app/data` prod / `data` dev). `UPLOAD_ROOT` is optional; add it only if the sibling
  `UPLOAD_ORIGINAL_ROOT` row's presence is meant to imply "both roots are overridable."
- **Confidence:** Medium-High on the RESTORE_MAINTENANCE_DIR gap; Medium (judgment call) on
  whether UPLOAD_ROOT rises to documentation-worthy given its test-only current usage.
  **Status:** open, low priority.

### DOC4-07 — `apps/web/README.md` test-count claim is stale (INFO / Medium)

- **Doc:** `apps/web/README.md:37`: *"`npm test` | Vitest unit suite (2000+ tests)"*.
- **Reality:** cycle-3's own terminal evidence (`.context/reviews/cycle-3-2026-07-07/_aggregate.md`)
  records "vitest 3091 passed / 4 skipped (335 files)" at HEAD `ec433dc4`. The literal "2000+"
  floor is still technically true but is ~35% understated and was already stale before this
  cycle (not introduced by cycle-3's changes) — flagging since the task asked for a full doc
  surface re-audit.
- **Suggested fix:** either drop the exact count ("Vitest unit suite") or update the approximate
  figure; low value in keeping it precise given how fast it drifts across ~100-cycle runs.
- **Confidence:** Medium (exact count is a snapshot; will drift again next cycle regardless).
  **Status:** open, cosmetic.

## Verified-clean (no action needed)

- **`not-found.tsx` cannot carry a metadata export; Next 16 docs confirm** — the cycle-3 comment
  at `apps/web/src/app/[locale]/layout.tsx:51-66` claims *"`not-found.tsx` cannot carry its own
  metadata export — only the experimental `global-not-found.js` supports that per Next 16
  docs."* Verified against the live Next.js docs (fetched `nextjs.org/docs/app/api-reference/
  file-conventions/not-found`, version 16.2.10, updated 2026-03-05): confirmed accurate —
  `global-not-found.js` is still experimental (opt-in via `experimental.globalNotFound`) and is
  the only one of the two conventions with documented `metadata`/`generateMetadata` support;
  plain `not-found.js` has no such support and Next.js auto-injects
  `<meta name="robots" content="noindex" />` on 404-status pages exactly as the comment and
  CLAUDE.md's C3-05 fix description assume.
  Sources: [not-found.js | Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
- **QUEUE_CONCURRENCY clamp formula** (`CLAUDE.md`'s env-var row, added this cycle for DOC3-01/C3-15)
  matches `resolveImageQueueConcurrency`/`IMAGE_QUEUE_RESERVED_LIVE_CONNECTIONS` in
  `apps/web/src/lib/image-queue.ts:124-138` exactly, including the "2 at the shipped pool of 10"
  arithmetic (verified `POOL_CONNECTION_LIMIT = 10` in `src/db/index.ts:23`) and the console.warn
  clamp-down message.
- **Single-writer guard section** (`CLAUDE.md` "Runtime topology" + advisory-lock scope note) —
  keepalive interval (60 s, unref'd `SELECT 1`), re-probe delay (25 s), DB-scoped lock name via
  `getSingleWriterLockName(dbName)` = `gallerykit_web_singleton_<sha256 first 16 hex>`, and the
  "quiet close + single re-probe, only THEN loud error" flow all match
  `apps/web/src/lib/single-writer-guard.ts` and `apps/web/src/lib/advisory-locks.ts:51-72` exactly.
- **migrate.js mixed-case rule narrative** (the C3-01 prose in CLAUDE.md, apart from the
  DOC4-01/DOC4-03 issues above) accurately describes `prepareLegacyDatabaseIfNeeded`'s
  cursor/trueDrift/pendingTail logic and `baselineAllJournalMigrations`'s `maxFolderMillis` guard
  at `apps/web/scripts/migrate.js:747-871`.
- **nginx runbook** (`CLAUDE.md`'s new "Applying host-nginx config changes" section) — the
  `zone=public rate=10r/s burst=40` and `zone=nextimage rate=30r/s burst=120` figures, the
  "deploys do not touch host nginx" claim, and the `nginx -t && nginx -s reload` procedure all
  match `apps/web/nginx/default.conf` verbatim (lines 10,19,260,292).
- **Inline comments in the other 10 of the 14 cycle-3-touched `.ts`/`.tsx` source files**
  (`[locale]/layout.tsx`, `similar/[id]/route.ts`, `clip-embeddings.ts`, `info-bottom-sheet.tsx`,
  `optimistic-image.tsx`, `photo-navigation.tsx`, `photo-viewer.tsx`, `admin-backfill-runner.ts`,
  `advisory-locks.ts`, `image-queue.ts`) read accurately against the diffs and current code —
  including the `info-bottom-sheet.tsx` cross-reference to `lightbox.tsx`'s unmount-scoped focus
  restore (confirmed present at `lightbox.tsx:457-475`) and the corrected "10s not 25s" retry
  comment in `image-queue.ts:944` (`MAX_RETRIES=3` → true max is 5s+10s=10s at that call site;
  confirmed arithmetic).
- **`package.json` scripts vs CLAUDE.md's documented commands** — `typecheck` (`typecheck:app` +
  `typecheck:scripts`), `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`,
  `db:push`, `db:seed`, `init`, `test`, `test:e2e` all match CLAUDE.md's Testing/Lint Gates
  sections and `apps/web/README.md`'s scripts table.
- **`.gitignore` cycle-3 diff** — only whitelists the new plan/deferred/carry-forward files,
  consistent with prior-cycle pattern; no issue.

## Summary

7 findings (0 CRIT, 0 HIGH-standalone, 2 MED-HIGH/MED confidence-High, 1 MED, 3 LOW, 1 INFO).
Highest-value: DOC4-01 (a brand-new "invariant" claim in the migration runbook is falsified by
existing code in the very function it describes) and DOC4-02 (a docstring that contradicts
itself within the same file, both halves edited in the same cycle) — both are quick, mechanical
fixes but matter because they're reasoning aids future engineers will trust literally. DOC4-04
and DOC4-05 are coverage/staleness gaps rather than false claims. No security- or
incident-causing doc/code mismatch found; the nginx runbook, single-writer guard, and
QUEUE_CONCURRENCY sections added this cycle are all accurate against the code.
