# Cycle 1 (2026-07-06) — Architect Review

Reviewer angle: architectural / design risks — coupling, layering, public/admin boundary erosion,
schema/data-layer drift, single-writer topology assumptions, process-local state, config-resolution
layering, migration/journal architecture, Docker/deploy architecture, dependency health, module
dependency cycles, and the sustainability of the source-regex contract-test architecture.

Target: HEAD `657eb024` (== `origin/master`, clean working tree except untracked review dirs).
Mode: read-only, static. No source files modified. All findings validated from code, not from
CLAUDE.md claims or comments.

## Scope discipline — explicitly NOT re-reported (already owned elsewhere)

Verified still-current but owned by prior/sibling artifacts, so recorded only as validation, not as new findings:

- Restore maintenance is a start-of-action precheck with no in-flight writer fence — **C77-ARCH-01 / C94-09**, deferred (`cycle-96-deferred.md:130`), re-confirmed this cycle by sibling `critic.md` CRIT-09. Re-validated: `settings.ts`, `tags.ts`, `sharing.ts`, `collections.ts` all call `getRestoreMaintenanceMessage()` once at the top and never re-check before their writes.
- `COUNT(*) OVER()` on the hot first-page public listing — **C94-11**, deferred; sibling `critic.md` CRIT-05.
- `image_embeddings` PK is `image_id`-only (no multi-model-version staging) — **C94-10 / C88-03**, deferred.
- Over-limit public `load_more` / `view_record` still do persistent-limiter DB work — **cycle-99 architect finding**; not duplicated.
- nginx `X-Forwarded-For` / rate-limit-key config contradiction — sibling `security-reviewer.md` SEC-01.
- Source-shaped regex test brittleness (general) — sibling `critic.md` CRIT-04. My ARCH-04 is a **narrow, additive** angle (ossification vs. the ARCH-01 fix), not a re-report of the general claim.

## Findings

### ARCH-01 — Value-level module dependency cycle: `photo-viewer.tsx` ⇄ `lightbox.tsx`

- Severity: Low-Medium. Confidence: High. Classification: coupling / init-order hazard / testability.
- Files: `apps/web/src/components/photo-viewer.tsx:24` (`import { Lightbox, LightboxTrigger } from '@/components/lightbox'`) and `apps/web/src/components/lightbox.tsx:11` (`import { isEditableTarget } from '@/components/photo-viewer'`).
- Why: These are the only two modules in a 248-file `src/` import-graph scan that form a cycle, and it is a **value** cycle (both sides import runtime bindings, not `import type`). It exists solely to share one small helper (`isEditableTarget`) whose only cross-module consumer is `lightbox.tsx`. ESM tolerates this today because both bindings are dereferenced at render/event-handler time, after both module bodies have finished evaluating — so it is benign at present.
- Failure scenario: the cycle is a latent landmine. If a future edit moves any use of `isEditableTarget` (or `Lightbox`/`LightboxTrigger`) to module-evaluation scope (a top-level `const x = isEditableTarget(...)`, a default-arg, a module-level constant table), it silently reads `undefined` from the not-yet-initialized partner module — a `TypeError`/wrong-behavior bug that depends on which module the bundler evaluates first and will not reproduce in isolation. It also blocks unit-testing either component without dragging in the other's full transitive tree.
- Fix: extract `isEditableTarget` (a pure DOM predicate) into a leaf module, e.g. `apps/web/src/lib/dom-target.ts` (client-safe, no imports), and have both components import it from there. The cycle disappears and both components become independently importable.

### ARCH-02 — `drizzle-kit` pinned to a snapshot prerelease build a major version ahead of `drizzle-orm`

- Severity: Low. Confidence: High. Classification: dependency health / build reproducibility.
- Files: `apps/web/package.json` (`"drizzle-kit": "1.0.0-beta.9-e89174b"`, devDependency), lockfile `package-lock.json:5446-5449` (resolves to `drizzle-kit-1.0.0-beta.9-e89174b.tgz`), vs `"drizzle-orm": "^0.45.2"`.
- Why: `1.0.0-beta.9-e89174b` is a git-hash-suffixed CI snapshot of a **1.0 beta**, while the runtime ORM is `drizzle-orm@0.45` (0.x). Two independent risks: (a) prerelease/snapshot npm builds are the most likely to be unpublished or superseded, and a hard-pinned exact snapshot means `npm ci` (used in the Dockerfile `deps`/`prod-deps` stages) breaks if that exact tarball is ever yanked — with no floor to fall back to; (b) a `db:push`/`generate` run with a 1.0 kit can emit DDL/introspection semantics targeting a newer ORM than the 0.45 the app actually links, producing schema drift between what the kit generates and what the ORM expects.
- Mitigation already in place: `db:push` is documented as local-throwaway only, and production schema is applied by hand-written SQL + `scripts/migrate.js` (not drizzle-kit), so the blast radius is local-dev ergonomics + CI reproducibility, not production schema. That is why this is Low, not Medium.
- Fix: pin `drizzle-kit` to a published stable release whose major matches the `drizzle-orm` line in use (or upgrade both together to a matched 1.0 pair), and prefer a caret/tilde range over an exact snapshot build so a yank does not wedge `npm ci`. Also note the sibling exact-version `overrides` (`esbuild: 0.28.1`, `postcss: 8.5.15`) in root `package.json` freeze those transitives off the patch stream — periodically re-evaluate whether the override is still needed.

### ARCH-03 — `db/index.ts` couples to `mysql2` internal wrapper structure to await the per-connection `group_concat_max_len` init

- Severity: Low. Confidence: Medium. Classification: library-internal coupling / silent-degradation surface.
- Files: `apps/web/src/db/index.ts:60-95` — the `poolConnection.on('connection', …)` handler stashes an init-query promise on a `Symbol` property of the callback connection, then a monkey-patched `poolConnection.getConnection` reaches into the returned wrapper's undocumented `.connection` property (`(connection as { connection?: … }).connection`) to retrieve and await that promise.
- Why: the *setting* of `SET group_concat_max_len = 65535` uses the documented `pool.on('connection')` API and is robust. But the *await-before-handout* logic depends on the exact shape of mysql2's `PromisePoolConnection` wrapper (that it exposes the underlying callback connection as `.connection`, and that `.promise()` exists on the callback side). This is undocumented internal structure. mysql2 has already forced multiple hardening rounds here (comments cite C4R/C6R/C8-F01/C4-C1/R10-C3/R12C12).
- Failure scenario: a future mysql2 upgrade that renames/removes the `.connection` wrapper property makes `underlying?.[connectionInitSymbol]` silently `undefined`. The init query still eventually runs (via `on('connection')`), so the failure mode is bounded — a race on the *first* query of each newly-created physical connection could observe the default 1024-byte `GROUP_CONCAT` limit and truncate a long tag aggregation (CSV export / gallery aria-labels) for that one query. Silent, transient, and un-covered by any test that doesn't exercise a >1024-byte `GROUP_CONCAT` through a cold pooled connection.
- Fix: prefer a transport that does not reach into wrapper internals — e.g., run the session `SET` lazily inside the query helpers on first use per checkout, or adopt an init mechanism mysql2 documents, or add a focused test that opens a fresh pooled connection and asserts a >1024-byte `GROUP_CONCAT` is not truncated (so an upgrade regression fails loudly instead of silently).

### ARCH-04 — Source-shape contract tests ossify the codebase against the very refactors that fix real defects

- Severity: Low. Confidence: High. Classification: test-architecture sustainability / maintainability. **Additive to sibling CRIT-04, not a re-report** — CRIT-04 argues the tests are brittle in general; this finding is the specific, demonstrable consequence.
- Evidence: 139 of 307 test files (~45%) read source text via `fs` + regex/AST (`grep -rlE 'readFileSync|readdirSync|fs\.read' src/__tests__ | wc -l` → 139). Many are `cycle-NN-source-contracts.test.ts` that assert on symbol names, import specifiers, and file paths. Concretely, `photo-viewer`/`lightbox` structure is pinned by at least `cycle-11`, `cycle-20`, `cycle-24`, `cycle-26`, `cycle-41` source-contract tests plus feature-shape tests.
- Why it matters architecturally: the safe fix for the confirmed ARCH-01 cycle — extract `isEditableTarget` to a leaf module — moves a symbol and rewrites two import lines, which is exactly the kind of edit these name/path-pinned tests flag as a regression even though behavior is unchanged. The test architecture therefore imposes a tax on structural improvement: every refactor pays in unrelated red tests, which biases the loop toward *not* refactoring (leave the cycle in place) — precisely the ossification that lets coupling like ARCH-01 accumulate. After 15+ more cycles this compounds: the same invariant is often enforced three times (a `lint:*` scanner script + its fixture test + a `cycle-NN-source-contracts` assertion), tripling the edit cost of any change that touches a guarded surface.
- Fix (direction, not a mandate this cycle): where a lint-gate scanner already enforces an invariant (`check-api-auth`, `check-action-origin`, `check-public-route-rate-limit`), retire the redundant `cycle-NN-source-contracts` duplicate rather than adding new ones; prefer behavior-level tests over name/path assertions for new contracts; and when a source-shape test is genuinely needed, key it on a stable exported contract (a type, a runtime value) instead of a private symbol name or file path.

## Areas verified SAFE (so the next architect need not re-derive)

- **Client/server boundary:** the only real `import 'server-only'` in `src/lib` is `caption-generator.ts` (server); other "server-only" grep hits are comment mentions. `caption-constants.ts` (imported by `photo-title.ts`, which 8 client components consume) is genuinely client-safe. The `client-server-only-boundary.test.ts` walk is AST-based and correctly distinguishes erased type-only imports from value imports.
- **Migration/journal architecture:** all 29 `drizzle/*.sql` files have journal entries and vice versa. The documented non-monotonic `when` at idx-7 (`0007_image_reactions`, 1746144000000 < idx-6) is exactly the case `migrate.js` handles via per-entry SHA-256 baselining + a post-condition assertion. `reconcileLegacySchema` in `migrate.js` is **current** — it mirrors the newest columns/indexes (`processing_settings_json`, `rate_limit_buckets.bucket_start` index, `image_embeddings(model_version,updated_at)` index, `uploaded_by`, `avif_10bit`, all color/HDR columns).
- **Public/admin data boundary:** no `(public)` route imports admin-select helpers. `publicSelectFields` and `publicMapSelectFields` are opt-out (rest-spread) derivations of `adminSelectFields`, but each is backed by the `_PrivacySensitiveKeys` `Extract<>` compile-time guard **and** `privacy-fields.test.ts`. The `data-timeline.ts` mirror imports the same `PrivacySensitiveKeys` union and applies its own `Extract` guard (`data-timeline.ts:65`). The residual "new admin column defaults public unless omitted" risk is the documented migration-checklist item, not a new gap.
- **Process-local / single-writer state:** `blur-data-url.ts` `rejectionLog` is LRU-capped (256). `settings-hash.ts` module cache is TTL-bounded (5 s, documented skew). `rate_limit_buckets` DB rows are GC'd hourly via `purgeOldBuckets`. `background-db-writes` Set self-drains per-entry (`.finally(delete)`). The hourly GC (`image-queue.ts:1043-1051`) runs each purge with its own `.catch()` so one failure cannot abort the others. No module-scope timers, no top-level `await`, no module-eval IO side effects anywhere in `src/lib`.
- **Connection-pool budget:** exactly one `mysql.createPool` (`db/index.ts:25`); every advisory-lock path (`admin-backfill-runner`, `image-queue`, `upload-processing-contract-lock`) draws from that same pool via `getConnection()`, so the `resolveBackfillConcurrency` math that assumes `POOL_CONNECTION_LIMIT=10` holds — no newer feature (CLIP, semantic search, LR upload) opens a second pool.
- **Docker/deploy:** `geoip-lite` is loaded via lazy dynamic `require` (defeats Next file-tracing) but its `data/*.dat` files still ship because the runner copies the **whole** `prod-deps` `node_modules` over the standalone tree (`Dockerfile` `COPY --from=prod-deps … ./node_modules`); resolution from `/app/apps/web/server.js` finds `/app/node_modules/geoip-lite`. Signal ownership (`NEXT_MANUAL_SIG_HANDLE`) and `exec`-as-PID-1 are correct for the graceful-flush shutdown design.

## Commonly-missed-issues sweep

- Import cycles: swept the full 248-file `src/` graph (alias + relative resolution); one cycle found (ARCH-01), reported.
- Hidden side effects at import: none (no top-level await / IO / timers in `lib`).
- Server code in client bundles: none reachable via value imports (AST boundary test + manual spot-check).
- Schema/reconcile drift: none — journal, SQL files, and `reconcileLegacySchema` agree.
- Config-layering staleness: settings-hash module cache is the only non-request-scoped config cache; TTL-bounded and documented.
- Dependency health: `drizzle-kit` snapshot pin (ARCH-02) + exact-version `overrides` noted; `geoip-lite` embedded DB freshness is a data-quality (not architecture) concern and is out of scope.
- Single-writer violations by newer features: none found; all writers share the one pool and the documented advisory locks.
- Not executed (static review): lint, typecheck, build, unit, e2e. Dynamic stress of the public rate-limit boundary and shutdown drain under sustained load remains a residual validation gap (already in the deferred manual-risk register).
