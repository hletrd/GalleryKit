# Cycle 7 Aggregate Review

Date: 2026-07-07
Review baseline: committed HEAD `14d31ea4` at fan-out (worktree advanced to `b4f57c6f`/`3dfb5cff`
mid-review — peer commits; lanes that noticed reviewed the newer committed state and said so).
Shared worktree: the peer session is active; peer-owned flat `.context/reviews/*.md`, `plan/`, and
`deferred-carry-forward.md` were not edited. The peer committed 10 of this cycle's lane files in
`3dfb5cff` (provenance-only commit; contents authored by this loop's lanes).

## Agent coverage

Fanned out 12 reviewer lanes concurrently, all on sonnet (per cycle-6 lesson). ALL 12 returned:
`security-reviewer`, `code-reviewer`, `critic`, `verifier`, `test-engineer`, `tracer`, `architect`,
`debugger`, `document-specialist`, `designer`, `feature-dev-code-reviewer`, `perf-reviewer`.
(First fan-out attempt was killed by an API session limit before any lane wrote output; the re-run
succeeded. The `feature-dev-code-reviewer` lane had no Write tool; its content was persisted
verbatim by the orchestrator.)

## Validation evidence gathered by lanes

- verifier: `lint`, `typecheck`, `npm test` (3198 passed / 4 skipped), `lint:api-auth`,
  `lint:action-origin`, `lint:public-route-rate-limit` — ALL PASS on the current tree.
  24 CLAUDE.md numeric/contract claims cross-checked — zero drift. Privacy-guard completeness
  independently re-derived (51 schema columns / 21-key sensitive union) — holds.
- security: `npm audit --omit=dev` 0 vulns; lint-gate invariants verified against handler code;
  sql-restore-scan, gps-exif-strip, data.ts guards, admin-tokens, OG routes, rate limiting,
  child-process spawning all re-verified — no new security defect (1 INFO).
- document-specialist: env-var table, advisory-lock names, nginx caps, migration journal 30/30,
  CLIP thresholds — all match code (1 LOW wording nuance).

Raw findings across lanes: ~24. Deduped below: 21 (20 open + 1 already closed by a peer commit).

## Deduped findings

Severity/confidence preserve the highest across duplicating lanes; cross-agent agreement noted.

### C7-01 — `logout()` during a restore/mutation-barrier window silently skips server-side session revocation  [SEV: MED-HIGH | CONF: High | correctness/security]
- Lanes: code-reviewer C7-CQ1 + critic C7-CRIT2 + debugger C7-DBG2 + tracer C7-TR2 + test-engineer C7-TE2 — **5-lane agreement, strongest signal this cycle**.
- `apps/web/src/app/actions/auth.ts:279-294` (introduced by peer commit `3acf638a`); `lib/session.ts:94-151`; `lib/admin-mutation-barrier.ts:76-92`.
- When the restore-maintenance marker or the mutation-barrier exclusive window is active, logout clears the cookie and redirects (looks like full success) but never deletes the DB session row and never retries later. The token remains verifiable server-side for up to 24 h. Note the restore import REPLACES the sessions table with backup contents, so even a delete just before import would be undone — a post-restore flush is the semantically correct revocation point.
- Fix: queue skipped revocations (token hashes) in a process-local pending set flushed when the maintenance window clears AND by the hourly maintenance sweep; add a behavioral test that a skipped-then-flushed token no longer verifies. (Alternative rejected: failing logout loudly would break the deliberate "cookie always clears locally" UX the peer chose.)

### C7-02 — the `RELEASE_LOCK`-failure "destroy, don't release" fix landed at only 1 of ~8 structurally identical advisory-lock call sites  [SEV: HIGH | CONF: Med-High | correctness/availability]
- Lanes: tracer C7-TR1 (HIGH) + debugger C7-DBG3 (MED-HIGH) — 2-lane agreement.
- Fixed site: `topics.ts` `withTopicRouteMutationLock` (peer `3acf638a`). Unfixed structurally identical sites: `apps/web/src/lib/image-queue.ts:659-667` and its duplicate `apps/web/src/lib/admin-backfill-runner.ts:381-387` (per-image processing claim), `apps/web/src/app/[locale]/admin/db-actions.ts` (~7 release sites incl. `:389-394`, `:585-647` — restore/backup path sharing one connection), `apps/web/src/app/actions/admin-users.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/app/actions/embeddings.ts`.
- A failed `RELEASE_LOCK` on a released-back connection leaks the advisory lock into the pool. For `gallerykit_db_restore` (checked with `GET_LOCK(...,0)` fail-fast) one transient release failure silently wedges the ENTIRE backup/restore feature until process restart; for the per-image claim it permanently blocks reprocessing of that image.
- Fix: apply the same destroy-on-failed-release pattern at every advisory-lock release site; add/extend source-contract or behavioral coverage so a 9th site can't ship without it.

### C7-03 — `IMAGE_BASE_URL` sanitizer failure silently disables the CDN app-wide with zero logging  [SEV: MED | CONF: High | operability]
- Lanes: critic C7-CRIT1 + debugger C7-DBG1 — 2-lane agreement. Refines deferred `C2-37res` with new evidence.
- `apps/web/src/lib/constants.ts:19` via `sanitizeImageBaseUrlSafely` (`content-security-policy.ts:40-46`, peer `05fa5cd1`).
- Malformed value / credentials / http-in-prod → returns `''` with no diagnostic; the sibling `buildCspSafely` in the SAME file logs once per process for the identical failure class.
- Fix: warn-once logging in `sanitizeImageBaseUrlSafely` mirroring `buildCspSafely` (server-side only; keep client silent or console.warn-once — decide in impl), plus test.

### C7-04 — collapsed nav search trigger is ~40 px wide (sub-44) whenever production semantic search is enabled and viewport < lg  [SEV: MED | CONF: High | a11y/touch-target]
- Lanes: designer C7-DES1 + critic C7-CRIT3 — 2-lane agreement.
- `apps/web/src/components/search.tsx:371-389`: `size="default"` + `className="h-11 gap-2 px-3"`, label span hidden below `lg` → icon-only 40×44. Invisible to `touch-target-audit.test.ts` (regex scanner can't see a MISSING width class).
- Fix: add a width floor for the collapsed state (e.g. `min-w-11`) so the icon-only rendering is ≥44 px.

### C7-05 — `getConfiguredBaseOrigin()` reads only `process.env.BASE_URL`, silently omitting the documented `siteConfig.url` fallback that all six sibling call sites share  [SEV: MED | CONF: High | config-precedence/security-hardening scope]
- Lanes: architect C7-ARCH1 (MED/High) + code-reviewer C7-CQ3 — 2-lane agreement.
- `apps/web/src/lib/request-origin.ts:45-48` vs `constants.ts:26`, `data.ts:1845/1869`, `seo-og-url.ts:3`, `sitemap.ts:18`, `scripts/ensure-site-config.mjs:12`.
- An operator following the Deployment Checklist (site-config.json `url` only, `BASE_URL` env unset) passes the build gate and gets correct SEO/OG URLs, but the CSRF same-origin canonical-anchor hardening (peer `57e2c5d3`/`d8fcb3d6`) silently stays inactive — origin checks fall back to header inference.
- Fix: make `getConfiguredBaseOrigin()` fall back to `siteConfig.url` (or extract one shared `effectiveBaseUrl` helper used by all seven sites); add a test asserting parity with `constants.ts` when only site-config is set.

### C7-06 — `next/image` `images.remotePatterns` for `IMAGE_BASE_URL` is frozen at Docker build time; runtime-only env change breaks thumbnails while CSP/URLs look fine  [SEV: MED | CONF: High | build-vs-runtime trap]
- Lane: architect C7-ARCH2 (verified against `.next/required-server-files.json`).
- `next.config.ts:8-28,117-121`; `Dockerfile:92-97`; `docker-compose.yml:7-9`.
- Fix (doc half, schedulable): CLAUDE.md env-table callout parallel to site-config's ARCH-03 — `IMAGE_BASE_URL` changes require a rebuild, not a restart. Code half (boot-time consistency probe comparing runtime env vs baked remotePatterns): defer with C4-25/C2-37res (fires only when a CDN is actually configured).

### C7-07 — `content-security-policy.ts` is now a three-context shared module (next-config load / server / client bundle) with nothing marking or enforcing that constraint  [SEV: LOW-MED | CONF: Med-High | module boundary]
- Lane: architect C7-ARCH3.
- Fix: boundary comment at top of file + a cheap source-guard test (no `node:` imports etc.).

### C7-08 — `parseImageBaseUrl` wrapper re-specifies `parseCspImageBaseUrl`'s default-environment expression  [SEV: LOW | CONF: High | duplicated logic]
- Lane: architect C7-ARCH4. `next.config.ts:8-10`.
- Fix: forward an optional `environment` param verbatim so exactly one signature owns the default.

### C7-09 — `searchImages()` tag-match branch silently narrows `tag_names` to only the matching tag(s)  [SEV: LOW-MED | CONF: Med-High | logic/consistency]
- Lane: code-reviewer C7-CQ2. `apps/web/src/lib/data.ts:1607-1614, 1693-1713`.
- The WHERE-filtered INNER JOIN feeds `GROUP_CONCAT`, so a photo tagged `sunset, beach, family` found via "beach" gets `tag_names = 'beach'` — result labels/alt text (`photo-title.ts`) show one tag while the same photo shows all three everywhere else.
- Fix: filter via an EXISTS subquery (keep the unfiltered LEFT JOIN aggregation for `tag_names`), NOT a raw-SQL correlated scalar subquery (that exact shape broke production before — CLAUDE.md `tagNamesAgg` note). Add a source/SQL-shape test.

### C7-10 — `SimilarPhotos` thumbnails reintroduce the duplicate-label ambiguity that peer `4d37daa4` just fixed in `search.tsx`  [SEV: MED | CONF: High | a11y]
- Lane: designer C7-DES2. `apps/web/src/components/similar-photos.tsx` (`SimilarThumb`), wired into `info-bottom-sheet.tsx` + `photo-viewer.tsx` by `14d31ea4`.
- Same-titled photos are indistinguishable to AT users; `search.tsx`'s `SearchResultItem` now appends `#{id}` and its commit directive says to keep future result labels aligned.
- Fix: append the same `#{id}` disambiguator in `SimilarThumb`'s aria-label/title.

### C7-11 — new duplicate bottom "Save" button on Settings has no ref, so the focus-restore hook yanks focus to the TOP button  [SEV: LOW | CONF: High | a11y regression]
- Lane: debugger C7-DBG4. `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:859` (peer `b4f57c6f`).
- Fix: give the bottom button its own ref (or a shared focus-restore target strategy) so focus returns to the button the user actually pressed.

### C7-12 — sql-restore-scan raw chunk-boundary bridge has only a 1-chunk lookback; a legally-possible short `fd.read()` lets a dangerous keyword span 3 reads and evade  [SEV: LOW | CONF: High (repro) / Med (real-world trigger) | security defense-in-depth]
- Lane: debugger C7-DBG5 (deterministic repro with short reads). `apps/web/src/lib/sql-restore-scan.ts` (bridge logic).
- Real-world trigger requires an actual OS-level short read (caller uses fixed 1 MiB chunks), so exploitability is low; still a cheap hardening: carry a persistent rolling raw tail (last N bytes of the cumulative stream, N ≥ longest keyword) across ALL appends instead of a per-chunk bridge.

### C7-13 — d8fcb3d6 Host-preference change is a no-op under the shipped nginx template; BASE_URL does the real work  [SEV: INFO | CONF: High | clarification]
- Lane: security C7-SEC1. `request-origin.ts:68-77`; `nginx/default.conf` sets Host and X-Forwarded-Host to the same `$host` everywhere.
- Fix: one-line comment near the host-preference branch so nobody mistakes the fallback for the primary CSRF defense. Chains context to deferred C1-11/C3-12op (unchanged).

### C7-14 — CLAUDE.md `IMAGE_BASE_URL` row says "must be absolute HTTPS" unconditionally; code enforces HTTPS only in production  [SEV: LOW | CONF: Med | doc drift]
- Lane: document-specialist C7-DOC1. Correct wording already exists in `.env.local.example` + `apps/web/README.md`.
- Fix: align the CLAUDE.md row (fold into the same CLAUDE.md edit as C7-06's rebuild callout).

### C7-15 — `armDbChildProcessWatchdog` control-flow fix shipped with zero behavioral coverage (and its cleanup-guard branch is currently dead code at all 3 call sites)  [SEV: HIGH (as test gap) | CONF: High | test-coverage]
- Lanes: test-engineer C7-TE1 (HIGH) + critic informational note (dead-code observation).
- `apps/web/src/app/[locale]/admin/db-actions.ts` (watchdog, peer `9cd8d3e8`).
- Fix: behavioral test with a fake child process + fake timers covering timeout-fires/settle-races; document (or exercise) the currently-dead cleanup-guard branch.

### C7-16 — `drizzle.config.ts` TLS-CA requirement locked only by source-pin; siblings already prove the cheap behavioral pattern  [SEV: MED | CONF: High | test-coverage]
- Lane: test-engineer C7-TE3. Fix: behavioral test invoking the config factory with a non-local DB_HOST and no DB_SSL_CA, asserting the throw.

### C7-17 — `getColorSettingsHash` has no test for the documented `image_sizes` order-independence invariant (AGG-R7C3-02)  [SEV: MED | CONF: High | test-coverage]
- Lane: test-engineer C7-TE4. Fix: pure-function test hashing `[640,1536]` vs `[1536,640]`.

### C7-18 — `purgeOldViewEvents` `MAX_BATCHES_PER_TABLE` safety cap untested  [SEV: MED | CONF: High | test-coverage]
- Lane: test-engineer C7-TE5. Fix: fixture test driving the chunked delete past the cap and asserting it stops.

### C7-19 — sql-restore-scan case-insensitive identifier matching unverified  [SEV: LOW | CONF: Med | test-coverage]
- Lane: test-engineer C7-TE6. Fix: cheap fixture cases (`drop table`, mixed case) — bundle with C7-12's regression test.

### C7-20 — client `imageUrl()` re-runs the full base-URL sanitize/parse on every call (up to ~600 per masonry mount when a CDN is configured)  [SEV: LOW-MED | CONF: High | perf hot-path]
- Lane: perf C7-PERF1. `apps/web/src/lib/image-url.ts:26-31` (peer `05fa5cd1`).
- Fix: lazily memoize the sanitized browser value in module scope (first client call), preserving SSR/hydration parity.

### C7-21 — sitemap missing `/map` — ALREADY CLOSED by peer commit `b4f57c6f` before aggregation  [SEV: LOW | status: closed-by-peer]
- Lane: critic C7-LOW1. Verified at HEAD: `STATIC_PUBLIC_PATHS = ['/timeline', '/map', '/privacy', '/about-gallerykit']`. No action.

### C7-22 — `restore-maintenance-recovery.ts` is dead code duplicating the shipped `.mjs` recovery CLI, no sync test  [SEV: MED | CONF: High | maintainability/ops-drift]
- Lane: code-reviewer C7-CQ5 (final version, landed after first aggregation pass).
- `apps/web/scripts/restore-maintenance-recovery.ts` (never invoked — `package.json` `restore:maintenance` runs the `.mjs` sibling); the `.mjs` hand-duplicates marker-path logic from `restore-maintenance-durable.ts` with no parity test. This is the incident-recovery command CLAUDE.md's own runbook depends on working under pressure.
- Fix: remove the dead `.ts` (after verifying zero references) and add a parity test pinning the `.mjs` marker path/name against `restore-maintenance-durable.ts` constants.

### C7-23 — dead/unreachable `remainingLimit <= 0` branches in `searchImages()` tag/alias fan-out  [SEV: LOW | CONF: High | dead code]
- Lane: code-reviewer C7-CQ6. `apps/web/src/lib/data.ts:1693,1705` — provably unreachable given the early-return guard above. Fix alongside C7-09 (same function).

### Numbering note
The code-reviewer lane's FINAL file renumbered its findings after the first aggregation pass:
its C7-CQ1 = aggregate C7-02 (db-actions lock-leak instance), C7-CQ2 = C7-01, C7-CQ3 = C7-09,
C7-CQ4 = C7-05, C7-CQ5 = C7-22, C7-CQ6 = C7-23. References above to "code-reviewer C7-CQn" for
C7-01/C7-05/C7-09 correspond to the final file's CQ2/CQ4/CQ3 respectively.

## AGENT FAILURES

- First fan-out attempt (12 lanes): all killed by an API session limit before writing output; full
  re-run succeeded (this aggregate reflects the re-run).
- `feature-dev-code-reviewer` (re-run): completed its review but had no Write tool; content
  persisted verbatim by the orchestrator to `feature-dev-code-reviewer.md`. Zero findings lane.

## Cross-agent agreement summary

| Finding | Lanes agreeing |
|---|---|
| C7-01 logout revocation gap | 5 (code-reviewer, critic, debugger, tracer, test-engineer) |
| C7-02 RELEASE_LOCK destroy pattern incomplete | 2 (tracer, debugger) |
| C7-03 IMAGE_BASE_URL silent degrade | 2 (critic, debugger) |
| C7-04 sub-44 search trigger | 2 (designer, critic) |
| C7-05 BASE_URL origin-check divergence | 2 (architect, code-reviewer) |
